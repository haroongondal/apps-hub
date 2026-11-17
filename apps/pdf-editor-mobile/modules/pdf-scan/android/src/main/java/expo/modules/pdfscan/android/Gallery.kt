package expo.modules.pdfscan.android

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import expo.modules.kotlin.exception.CodedException
import expo.modules.pdfscan.core.ImageNames

object Gallery {
  fun save(context: Context, paths: List<String>, album: String): Int {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      throw CodedException("save_failed", "Saving to Photos needs Android 10 or later.", null)
    }
    val files = paths.map(::existingFile)
    val resolver = context.contentResolver
    val collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    val now = System.currentTimeMillis()
    var saved = 0
    files.forEachIndexed { i, file ->
      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, ImageNames.galleryName(album, now, i))
        put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
        put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/${ImageNames.clean(album)}")
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }
      val uri = resolver.insert(collection, values) ?: return@forEachIndexed
      try {
        val out = resolver.openOutputStream(uri) ?: throw IllegalStateException("no output stream")
        out.use { o -> file.inputStream().use { it.copyTo(o) } }
        resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
        saved++
      } catch (e: Exception) {
        Log.w("PdfScan", "gallery save failed for ${file.name}", e)
        resolver.delete(uri, null, null)
      }
    }
    if (saved == 0 && files.isNotEmpty()) {
      throw CodedException("save_failed", "The images couldn't be saved to Photos. Free some space and try again.", null)
    }
    return saved
  }
}
