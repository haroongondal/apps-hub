package expo.modules.haloengine.android

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.net.Uri
import expo.modules.haloengine.core.ColorSource
import expo.modules.haloengine.core.DrawList
import expo.modules.haloengine.core.FaceInput
import expo.modules.haloengine.core.FaceOptions
import expo.modules.haloengine.core.Faces
import expo.modules.haloengine.core.SettingsColors
import expo.modules.haloengine.core.Theme
import expo.modules.haloengine.core.Themes
import java.io.File
import java.util.Calendar

/** A theme's face on its background as a PNG, drawn offscreen with the same Face + OpPainter that FaceView uses (FaceView itself needs a window). */
object FacePreview {
  private const val MAX = 2000

  fun render(ctx: Context, themeId: String, w: Int, h: Int): String {
    require(Themes.validId(themeId)) { "Invalid theme id" }
    val width = w.coerceIn(16, MAX)
    val height = h.coerceIn(16, MAX)
    val settings = SettingsStore.load(ctx)
    val faceIds = Faces.all.map { it().id }.toSet()
    // Unknown id -> first theme, like the always-on screen.
    val base = settings.themes.firstOrNull { it.id == themeId } ?: settings.themes.first()
    val theme = Themes.usable(base, faceIds, Backgrounds.exists(ctx, base.id))
    val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    try {
      draw(ctx, theme, Canvas(bmp), width, height)
      val dir = File(ctx.cacheDir, "preview").apply { mkdirs() }
      dir.listFiles { f -> f.name.startsWith("$themeId-") }?.forEach { it.delete() } // a new name each time keeps image caches fresh
      val out = File(dir, "$themeId-${System.currentTimeMillis()}.png")
      out.outputStream().use { check(bmp.compress(Bitmap.CompressFormat.PNG, 100, it)) { "PNG encode failed" } }
      return Uri.fromFile(out).toString()
    } finally {
      bmp.recycle()
    }
  }

  private val HEX = Regex("^#[0-9a-fA-F]{6}$")

  /** One face on black with the given options and colours, for the face grid; an unknown face draws big-digits. */
  fun renderThumb(ctx: Context, faceId: String, options: Map<String, Any?>, colours: List<String>, w: Int, h: Int): String {
    require(Themes.validId(faceId)) { "Invalid face id" }
    val width = w.coerceIn(16, MAX)
    val height = h.coerceIn(16, MAX)
    val face = Faces.create(faceId)
    val theme = Theme(
      id = "thumb", name = "thumb", face = face.id, faceOptions = faceOptions(options),
      colours = SettingsColors(ColorSource.PALETTE, colours.filter { HEX.matches(it) }.take(4).ifEmpty { listOf("#FFFFFF") }),
    )
    val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    try {
      draw(ctx, theme, Canvas(bmp), width, height)
      val dir = File(ctx.cacheDir, "thumbs").apply { mkdirs() }
      dir.listFiles { f -> f.name.startsWith("${face.id}-") }?.forEach { it.delete() } // one thumb per face; a new name each time keeps image caches fresh
      val out = File(dir, "${face.id}-${System.currentTimeMillis()}.png")
      out.outputStream().use { check(bmp.compress(Bitmap.CompressFormat.PNG, 100, it)) { "PNG encode failed" } }
      return Uri.fromFile(out).toString()
    } finally {
      bmp.recycle()
    }
  }

  private fun faceOptions(m: Map<String, Any?>): FaceOptions {
    val d = FaceOptions()
    fun flag(k: String, default: Boolean) = m[k] as? Boolean ?: default
    return FaceOptions(
      size = (m["size"] as? String)?.takeIf { it in setOf("s", "m", "l") } ?: d.size,
      position = (m["position"] as? String)?.takeIf { it in setOf("top", "centre", "bottom") } ?: d.position,
      h24 = flag("h24", d.h24), date = flag("date", d.date), battery = flag("battery", d.battery), alarm = flag("alarm", d.alarm), seconds = flag("seconds", d.seconds),
    )
  }

  private fun draw(ctx: Context, theme: Theme, canvas: Canvas, w: Int, h: Int) {
    canvas.drawColor(Color.BLACK)
    if (theme.photo) photo(Backgrounds.file(ctx, theme.id), w, h)?.let { p ->
      val k = maxOf(w / p.width.toFloat(), h / p.height.toFloat()) // centre crop
      val dx = (w - p.width * k) / 2f
      val dy = (h - p.height * k) / 2f
      canvas.save()
      canvas.translate(dx, dy)
      canvas.scale(k, k)
      canvas.drawBitmap(p, 0f, 0f, null)
      canvas.restore()
      p.recycle()
      canvas.drawColor(Color.argb((theme.dim.coerceIn(0.0, 1.0) * 255).toInt(), 0, 0, 0))
    }
    val now = Calendar.getInstance()
    val pad = minOf(w, h) * 0.06f
    val input = FaceInput(
      now.get(Calendar.HOUR_OF_DAY), now.get(Calendar.MINUTE), now.get(Calendar.SECOND), "Wed 18 Nov", 87, false,
      if (theme.faceOptions.alarm) "07:30" else null, colours(ctx, theme), pad, pad, w - pad, h - pad, theme.faceOptions,
    )
    val list = DrawList()
    Faces.create(theme.face).draw(input, list)
    val painter = OpPainter(ctx)
    for (i in 0 until list.opCount) painter.draw(canvas, null, list, i, 1f)
  }

  private fun colours(ctx: Context, theme: Theme): IntArray {
    val palette = theme.colours.palette.mapNotNull { runCatching { Color.parseColor(it) or (0xFF shl 24) }.getOrNull() }.toIntArray()
    val live = when (theme.colours.source) {
      ColorSource.WALLPAPER -> Colours.wallpaper(ctx)
      else -> null // album art needs a playing track; the palette stands in
    }
    return live ?: palette.takeIf { it.isNotEmpty() } ?: intArrayOf(Color.WHITE)
  }

  /** Subsampled decode close to the target size, so no full-size bitmap is held. */
  private fun photo(f: File, w: Int, h: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(f.path, bounds)
    if (bounds.outWidth <= 0) return null
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= w && bounds.outHeight / (sample * 2) >= h) sample *= 2
    return BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = sample })
  }
}
