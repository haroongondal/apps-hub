package expo.modules.designmedia.android

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import expo.modules.designmedia.core.Kind
import expo.modules.designmedia.core.Output
import expo.modules.designmedia.core.Target
import expo.modules.designmedia.core.folderOf
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
    val bytes = temp.length()
    try {
      requireNotNull(resolver.openOutputStream(uri)) { "MediaStore couldn't open the output." }.use { out ->
        temp.inputStream().use { it.copyTo(out) }
      }
      resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
    } catch (e: Exception) {
      resolver.delete(uri, null, null)
      throw e
    }
    temp.delete()
    val landed = resolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)
      ?.use { c -> if (c.moveToFirst()) c.getString(0) else null } ?: name
    return Output(landed, uri.toString(), bytes)
  }

  fun deletePending(context: Context) {
    Kind.entries.forEach { kind ->
      context.contentResolver.delete(
        collectionOf(kind),
        "${MediaStore.MediaColumns.IS_PENDING} = 1 AND ${MediaStore.MediaColumns.RELATIVE_PATH} = ?",
        arrayOf(folderOf(kind)),
      )
    }
  }
}
