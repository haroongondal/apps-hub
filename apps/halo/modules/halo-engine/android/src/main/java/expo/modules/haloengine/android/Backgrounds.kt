package expo.modules.haloengine.android

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.provider.MediaStore
import expo.modules.haloengine.core.SettingsCodec
import expo.modules.haloengine.core.Themes
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import java.io.File

/** The system photo picker (no storage permission); the input is the theme id, the output the picked photo or null. */
class PickBackgroundContract : AppContextActivityResultContract<String, Uri?> {
  override fun createIntent(context: Context, input: String) = Intent(MediaStore.ACTION_PICK_IMAGES)
  override fun parseResult(input: String, resultCode: Int, intent: Intent?): Uri? = if (resultCode == android.app.Activity.RESULT_OK) intent?.data else null
}

/** Theme photos: filesDir/bg/<id>.jpg, a copy scaled to at most 1440 px on the long side. Deleting a theme must call delete(id). */
object Backgrounds {
  private const val MAX_PX = 1440

  /** Throws for an id that is not `[a-z0-9-]{1,40}`, before any path is built. */
  fun file(ctx: Context, id: String): File {
    require(Themes.validId(id)) { "Invalid theme id" }
    return File(File(ctx.filesDir, "bg"), "$id.jpg")
  }

  fun exists(ctx: Context, id: String): Boolean = Themes.validId(id) && file(ctx, id).isFile

  /** Decodes straight to the target size (never a full-size bitmap), applies EXIF rotation, writes through a temp file. */
  fun save(ctx: Context, id: String, src: Uri) {
    val dest = file(ctx, id)
    dest.parentFile!!.mkdirs()
    val tmp = File(dest.parentFile, "$id.jpg.tmp")
    try {
      val bmp = ImageDecoder.decodeBitmap(ImageDecoder.createSource(ctx.contentResolver, src)) { decoder, info, _ ->
        val (w, h) = Themes.fit(info.size.width, info.size.height, MAX_PX)
        decoder.setTargetSize(w, h)
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
      }
      try {
        tmp.outputStream().use { check(bmp.compress(Bitmap.CompressFormat.JPEG, 88, it)) { "JPEG encode failed" } }
      } finally {
        bmp.recycle()
      }
      check(tmp.renameTo(dest)) { "Could not store the photo" }
    } finally {
      tmp.delete()
    }
  }

  fun delete(ctx: Context, id: String) {
    if (Themes.validId(id)) file(ctx, id).delete()
  }

  /** Sets `photo` on the stored theme; false when no theme has that id. */
  fun setPhoto(ctx: Context, id: String, on: Boolean): Boolean {
    val s = SettingsStore.load(ctx)
    if (s.themes.none { it.id == id }) return false
    SettingsStore.write(ctx, SettingsCodec.encode(s.copy(themes = s.themes.map { if (it.id == id) it.copy(photo = on) else it })))
    return true
  }
}
