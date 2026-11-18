package expo.modules.designmedia.android

import android.content.ContentUris
import android.content.Context
import android.provider.MediaStore
import android.util.Size
import expo.modules.designmedia.core.PhotoKey
import expo.modules.designmedia.core.clipTensor

object Gallery {
  private val IMAGES = MediaStore.Images.Media.EXTERNAL_CONTENT_URI

  // Changes whenever a photo is added, edited or removed, so a scan can tell whether it has anything to do.
  // The count is there because changing the Selected-photos choice does not move the generation.
  fun stamp(ctx: Context): String =
    "${MediaStore.getVersion(ctx)}:${MediaStore.getGeneration(ctx, MediaStore.VOLUME_EXTERNAL_PRIMARY)}:${visibleCount(ctx)}"

  private fun visibleCount(ctx: Context): Int {
    val cursor = ctx.contentResolver.query(IMAGES, arrayOf(MediaStore.Images.Media._ID), null, null, null)
      ?: throw IllegalStateException("gallery query failed")
    return cursor.use { it.count }
  }

  // Newest first, so recent photos become searchable first.
  fun list(ctx: Context): List<PhotoKey> {
    val cols = arrayOf(MediaStore.Images.Media._ID, MediaStore.Images.Media.DATE_MODIFIED, MediaStore.Images.Media.SIZE)
    val keys = ArrayList<PhotoKey>()
    // A null cursor means the query failed; an empty list would make the scan treat every photo as gone.
    val cursor = ctx.contentResolver.query(IMAGES, cols, null, null, "${MediaStore.Images.Media.DATE_ADDED} DESC")
      ?: throw IllegalStateException("gallery query failed")
    cursor.use { c ->
      while (c.moveToNext()) keys.add(PhotoKey(c.getLong(0), c.getLong(1), c.getLong(2)))
    }
    return keys
  }

  // Null when the photo is gone or unreadable (deleted or edited mid-scan); the scan skips it.
  fun tensor(ctx: Context, id: Long): FloatArray? = try {
    val bmp = ctx.contentResolver.loadThumbnail(ContentUris.withAppendedId(IMAGES, id), Size(256, 256), null)
    val argb = IntArray(bmp.width * bmp.height).also { bmp.getPixels(it, 0, bmp.width, 0, 0, bmp.width, bmp.height) }
    clipTensor(argb, bmp.width, bmp.height).also { bmp.recycle() }
  } catch (e: Exception) {
    null
  }
}
