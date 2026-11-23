package expo.modules.designmedia.android

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.provider.MediaStore
import expo.modules.designmedia.applink.AppLinkTarget
import expo.modules.designmedia.core.DeputyProposal
import expo.modules.designmedia.core.NexusShare
import expo.modules.designmedia.core.PhotoTimes
import expo.modules.designmedia.core.TrustedStart
import expo.modules.kotlin.Promise
import java.util.concurrent.atomic.AtomicReference

// Hand-offs to the owner's other apps. Each one opens a screen in that app; nothing is sent from here.
object Handoffs {
  private val IMAGES = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
  private val deputyPromise = AtomicReference<Promise?>(null)

  // Deputy refuses a plain startActivity: only a start for a result gives it a calling package to check.
  fun proposeToDeputy(activity: Activity?, task: String, apps: List<String>, promise: Promise) {
    val extras = DeputyProposal.extras(task, apps)
    when {
      extras == null || activity == null -> promise.resolve("refused")
      !deputyPromise.compareAndSet(null, promise) -> promise.resolve("busy")
      else -> {
        val intent = Intent(DeputyProposal.ACTION).setPackage(DeputyProposal.DEPUTY_PACKAGE)
        (extras["task"] as? String)?.let { intent.putExtra("task", it) }
        (extras["apps"] as? List<*>)?.filterIsInstance<String>()?.let { intent.putExtra("apps", it.toTypedArray()) }
        val failed = try {
          val started = TrustedStart.begin({ AppLinkTarget.trustedActivity(activity, intent) }) {
            activity.startActivityForResult(intent, DeputyProposal.REQUEST_CODE)
          }
          if (started) null else "not_installed"
        } catch (_: ActivityNotFoundException) {
          "not_installed"
        } catch (_: SecurityException) {
          "refused"
        }
        if (failed != null) deputyPromise.getAndSet(null)?.resolve(failed)
      }
    }
  }

  fun onDeputyResult(requestCode: Int, resultOk: Boolean, code: String?) {
    if (requestCode != DeputyProposal.REQUEST_CODE) return
    deputyPromise.getAndSet(null)?.resolve(DeputyProposal.outcome(resultOk, code))
  }

  fun dropDeputy() {
    deputyPromise.getAndSet(null)?.resolve("cancelled")
  }

  fun sendToNexus(activity: Activity?, context: Context, uris: List<String>): String {
    val ids = NexusShare.ids(uris, IMAGES.toString()) ?: throw NotAGalleryPhoto()
    val streams = ArrayList(ids.map { ContentUris.withAppendedId(IMAGES, it) })
    val send = Intent(Intent.ACTION_SEND_MULTIPLE)
      .setPackage(NexusShare.PACKAGE)
      .setType("image/*")
      .putParcelableArrayListExtra(Intent.EXTRA_STREAM, streams)
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    send.clipData = ClipData.newRawUri(null, streams.first()).apply { streams.drop(1).forEach { addItem(ClipData.Item(it)) } }
    // Nexus's share screen is an ordinary share target, not a link action, so it holds no link permission.
    val starter: Context = activity ?: context
    return try {
      val started = TrustedStart.begin({ AppLinkTarget.trustedActivity(starter, send, requireLinkPermission = false) }) {
        if (activity != null) activity.startActivity(send) else context.startActivity(send.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      if (started) "sent" else "not_installed"
    } catch (_: ActivityNotFoundException) {
      "not_installed"
    }
  }

  fun photosTaken(context: Context, fromMs: Long, toMs: Long, uris: List<String>?): List<Map<String, Any>> {
    val only = uris?.mapNotNull { CleanupTool.idOf(it) }?.toSet()
    val cols = arrayOf(MediaStore.Images.Media._ID, MediaStore.Images.Media.DATE_TAKEN, MediaStore.Images.Media.DATE_MODIFIED)
    val rows = ArrayList<Pair<Long, Long>>()
    val cursor = context.contentResolver.query(IMAGES, cols, null, null, null) ?: throw GalleryUnreadable()
    cursor.use { c ->
      while (c.moveToNext()) rows.add(c.getLong(0) to PhotoTimes.takenAt(if (c.isNull(1)) null else c.getLong(1), c.getLong(2)))
    }
    return PhotoTimes.within(rows, fromMs, toMs, only).map { (id, at) -> mapOf("uri" to ContentUris.withAppendedId(IMAGES, id).toString(), "takenAt" to at) }
  }
}
