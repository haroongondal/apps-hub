package expo.modules.designmedia.android

import android.content.ContentValues
import android.content.Context
import android.provider.MediaStore
import expo.modules.designmedia.core.Output
import java.io.File

object Outputs {
  const val FOLDER = "Movies/Design Editor/"
  private const val MIME = "video/mp4"
  private val collection = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)

  fun exists(context: Context, name: String): Boolean = context.contentResolver.query(
    collection,
    arrayOf(MediaStore.MediaColumns._ID),
    "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND ${MediaStore.MediaColumns.RELATIVE_PATH} = ?",
    arrayOf(name, FOLDER),
    null,
  )?.use { it.count > 0 } ?: false

  fun publish(context: Context, temp: File, name: String): Output {
    val resolver = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, name)
      put(MediaStore.MediaColumns.MIME_TYPE, MIME)
      put(MediaStore.MediaColumns.RELATIVE_PATH, FOLDER)
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
    return Output(name, uri.toString(), bytes)
  }

  fun deletePending(context: Context) {
    context.contentResolver.delete(
      collection,
      "${MediaStore.MediaColumns.IS_PENDING} = 1 AND ${MediaStore.MediaColumns.RELATIVE_PATH} = ?",
      arrayOf(FOLDER),
    )
  }
}
