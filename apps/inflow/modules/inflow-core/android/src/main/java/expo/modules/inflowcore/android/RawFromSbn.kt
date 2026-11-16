package expo.modules.inflowcore.android

import android.app.Notification
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import androidx.core.os.BundleCompat
import expo.modules.inflowcore.core.MediaSupplier
import expo.modules.inflowcore.core.RawMedia
import expo.modules.inflowcore.core.RawMessage
import expo.modules.inflowcore.core.RawNotification
import java.io.ByteArrayOutputStream
import java.io.InputStream

/** Reads the files a WhatsApp notification exposes, only when Ingest calls it (see MediaSupplier). Every failure is counted, never logged or thrown: the message text must still be saved. */
class MediaReader(private val context: Context, private val bump: (String, Long) -> Unit, private val lastMime: (String) -> Unit) {
  fun fromUri(uri: Uri, mime: String): RawMedia? {
    lastMime(mime)
    return try {
      val bytes = context.contentResolver.openInputStream(uri)?.use { readCapped(it, MediaStore.MAX_BYTES + 1) }
      when {
        bytes == null -> unreadable()
        bytes.size > MediaStore.MAX_BYTES -> { bump("mediaTooBig", 1); null }
        else -> RawMedia(mime, bytes)
      }
    } catch (e: Exception) {
      unreadable()
    } catch (e: OutOfMemoryError) {
      unreadable()
    }
  }

  /** A BigPicture bitmap as JPEG, quality 90 (R39). The contact's largeIcon is never read. */
  fun fromPicture(extras: android.os.Bundle): RawMedia? = try {
    val bitmap = BundleCompat.getParcelable(extras, Notification.EXTRA_PICTURE, Bitmap::class.java)
      ?: pictureIcon(extras)
    if (bitmap == null) {
      null
    } else {
      lastMime("image/jpeg")
      val out = ByteArrayOutputStream()
      if (bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)) RawMedia("image/jpeg", out.toByteArray()) else unreadable()
    }
  } catch (e: Exception) {
    unreadable()
  } catch (e: OutOfMemoryError) {
    unreadable()
  }

  private fun pictureIcon(extras: android.os.Bundle): Bitmap? =
    if (Build.VERSION.SDK_INT >= 31) {
      BundleCompat.getParcelable(extras, Notification.EXTRA_PICTURE_ICON, Icon::class.java)?.loadDrawable(context)?.let(::toBitmap)
    } else {
      null
    }

  private fun unreadable(): RawMedia? {
    bump("mediaUnreadable", 1)
    return null
  }

  private fun toBitmap(d: Drawable): Bitmap? {
    if (d is BitmapDrawable) return d.bitmap
    val w = d.intrinsicWidth
    val h = d.intrinsicHeight
    if (w <= 0 || h <= 0) return null
    return Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also { d.setBounds(0, 0, w, h); d.draw(Canvas(it)) }
  }

  private fun readCapped(input: InputStream, max: Int): ByteArray {
    val out = ByteArrayOutputStream()
    val buf = ByteArray(64 * 1024)
    while (out.size() < max) {
      val n = input.read(buf, 0, minOf(buf.size, max - out.size()))
      if (n < 0) break
      out.write(buf, 0, n)
    }
    return out.toByteArray()
  }
}

object RawFromSbn {
  // The owner's override stores media for WhatsApp only; other apps' pictures are not saved.
  private val MEDIA_PKGS = setOf("com.whatsapp", "com.whatsapp.w4b")

  private fun hasPicture(extras: android.os.Bundle) =
    extras.containsKey(Notification.EXTRA_PICTURE) || (Build.VERSION.SDK_INT >= 31 && extras.containsKey(Notification.EXTRA_PICTURE_ICON))

  fun from(sbn: StatusBarNotification, appLabel: String, media: MediaReader? = null): RawNotification {
    val n = sbn.notification
    val extras = n.extras
    val wantMedia = media != null && sbn.packageName in MEDIA_PKGS
    val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(n)
    val user = style?.user
    val messages = style?.messages.orEmpty().map { m ->
      val p = m.person
      // The owner's own messages: same person key as MessagingStyle.user, else the same name.
      val own = p != null && user != null && (if (p.key != null && user.key != null) p.key == user.key else p.name?.toString() == user.name?.toString())
      val uri = m.dataUri
      val mime = m.dataMimeType
      val file: MediaSupplier? = if (wantMedia && uri != null && mime != null) ({ media?.fromUri(uri, mime) }) else null
      RawMessage(p?.name?.toString(), m.text?.toString().orEmpty(), m.timestamp, own, file)
    }
    return RawNotification(
      pkg = sbn.packageName,
      appLabel = appLabel,
      key = sbn.key,
      postTime = sbn.postTime,
      ongoing = n.flags and (Notification.FLAG_ONGOING_EVENT or Notification.FLAG_FOREGROUND_SERVICE) != 0,
      groupSummary = n.flags and Notification.FLAG_GROUP_SUMMARY != 0,
      title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
      text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString(),
      bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString(),
      subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString(),
      conversationTitle = extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)?.toString(),
      isGroupConversation = extras.getBoolean(Notification.EXTRA_IS_GROUP_CONVERSATION),
      messages = messages,
      textLines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.map { it.toString() }.orEmpty(),
      chatTag = sbn.tag,
      shortcutId = NotificationCompat.getShortcutId(n),
      picture = if (wantMedia && hasPicture(extras)) ({ media?.fromPicture(extras) }) else null,
    )
  }
}
