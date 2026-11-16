package expo.modules.haloengine.android

import android.app.WallpaperManager
import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadata
import android.media.session.MediaController
import expo.modules.haloengine.core.Quantize

/** Edge colours from the playing track's art or the system wallpaper. Null means "use the settings palette". */
object Colours {
  private const val SIZE = 64
  private val ART_KEYS = listOf(MediaMetadata.METADATA_KEY_ALBUM_ART, MediaMetadata.METADATA_KEY_ART, MediaMetadata.METADATA_KEY_DISPLAY_ICON)
  @Volatile private var failureLogged = false

  /** Blocking bitmap work: call off the main thread. */
  fun albumArt(ctx: Context, controller: MediaController?): IntArray? = guarded(ctx, "albumArt") {
    val meta = controller?.metadata ?: return@guarded null
    val src = ART_KEYS.firstNotNullOfOrNull { meta.getBitmap(it) } ?: return@guarded null
    val scaled = Bitmap.createScaledBitmap(src, SIZE, SIZE, true)
    try {
      val px = IntArray(SIZE * SIZE)
      scaled.getPixels(px, 0, SIZE, 0, 0, SIZE, SIZE)
      Quantize.dominant(px, 4).map(Quantize::lift).toIntArray().takeIf { it.isNotEmpty() }
    } finally {
      if (scaled !== src) scaled.recycle()
    }
  }

  fun wallpaper(ctx: Context): IntArray? = guarded(ctx, "wallpaper") {
    val c = ctx.getSystemService(WallpaperManager::class.java).getWallpaperColors(WallpaperManager.FLAG_SYSTEM) ?: return@guarded null
    listOfNotNull(c.primaryColor, c.secondaryColor, c.tertiaryColor).map { Quantize.lift(it.toArgb()) }.toIntArray().takeIf { it.isNotEmpty() }
  }

  private fun guarded(ctx: Context, what: String, block: () -> IntArray?): IntArray? = try {
    block()
  } catch (e: Exception) {
    if (!failureLogged) {
      failureLogged = true
      ProbeLog.log(ctx, "colours", "$what FAILED ${e.javaClass.name}: ${e.message}")
    }
    null
  }
}
