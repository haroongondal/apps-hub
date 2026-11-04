package expo.modules.designmedia.android

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import expo.modules.designmedia.core.Kind
import expo.modules.designmedia.core.Output
import expo.modules.designmedia.core.PendingLog
import expo.modules.designmedia.core.Target
import java.io.File

object Outputs {
  private fun collectionOf(kind: Kind): Uri = when (kind) {
    Kind.VIDEO -> MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    Kind.AUDIO -> MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    Kind.IMAGE -> MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
  }

  fun exists(context: Context, target: Target, name: String): Boolean = context.contentResolver.query(
    collectionOf(target.kind),
    arrayOf(MediaStore.MediaColumns._ID),
    "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND ${MediaStore.MediaColumns.RELATIVE_PATH} = ?",
    arrayOf(name, target.folder),
    null,
  )?.use { it.count > 0 } ?: false

  fun publish(context: Context, temp: File, name: String, target: Target): Output {
    val resolver = context.contentResolver
    val collection = collectionOf(target.kind)
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, name)
      put(MediaStore.MediaColumns.MIME_TYPE, target.mime)
      put(MediaStore.MediaColumns.RELATIVE_PATH, target.folder)
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }
    val uri = requireNotNull(resolver.insert(collection, values)) { "MediaStore refused the output." }
    val pending = pendingLog(context)
    pending.add(uri.toString())
    val bytes = temp.length()
    try {
      requireNotNull(resolver.openOutputStream(uri)) { "MediaStore couldn't open the output." }.use { out ->
        temp.inputStream().use { it.copyTo(out) }
      }
      resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
    } catch (e: Exception) {
      resolver.delete(uri, null, null)
      pending.remove(uri.toString())
      throw e
    }
    pending.remove(uri.toString())
    temp.delete()
    val landed = resolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)
      ?.use { c -> if (c.moveToFirst()) c.getString(0) else null } ?: name
    return Output(landed, uri.toString(), bytes)
  }

  private fun pendingLog(context: Context) = PendingLog(File(context.filesDir, "pending-outputs.txt"))

  // Only rows this queue inserted and never finished (a crash mid-copy). Never a folder-wide delete.
  fun deletePending(context: Context) {
    val log = pendingLog(context)
    log.all().forEach { context.contentResolver.delete(Uri.parse(it), "${MediaStore.MediaColumns.IS_PENDING} = 1", null) }
    log.clear()
  }
}
