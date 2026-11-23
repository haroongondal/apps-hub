package expo.modules.haloengine.android

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import expo.modules.haloengine.core.DrawList

class OpPainter(private val ctx: Context) {
  private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.BUTT
    strokeJoin = Paint.Join.ROUND
  }
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val type = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply { style = Paint.Style.FILL }
  private val line = Path()
  private val fonts by lazy(LazyThreadSafetyMode.NONE) { Fonts.get(ctx) }

  fun draw(canvas: Canvas, glowCanvas: Canvas?, list: DrawList, i: Int, alpha: Float) {
    val kind = list.kind[i]
    val paint = when (kind) { DrawList.DOT -> fill; DrawList.TEXT -> type; else -> stroke }
    paint.color = list.color[i]
    if (alpha < 1f) paint.alpha = (paint.alpha * alpha).toInt()
    val pts = list.points
    val at = list.start[i]
    when (kind) {
      DrawList.POLYLINE -> {
        paint.strokeWidth = list.size[i]
        line.rewind()
        line.moveTo(pts[at], pts[at + 1])
        for (k in 1 until list.count[i]) line.lineTo(pts[at + 2 * k], pts[at + 2 * k + 1])
        if (list.closed[i]) line.close()
      }
      DrawList.TEXT -> {
        type.textSize = list.size[i]
        type.typeface = fonts[list.font[i]]
        type.textAlign = ALIGNS[list.align[i]]
      }
    }
    // A blurred pass alone washes the line out to a faint haze, so the sharp shape is drawn over its glow.
    if (glowCanvas != null && list.glow[i] >= 0.5f) shape(glowCanvas, list, i, paint, pts[at], pts[at + 1])
    shape(canvas, list, i, paint, pts[at], pts[at + 1])
  }

  private fun shape(canvas: Canvas, list: DrawList, i: Int, paint: Paint, x: Float, y: Float) {
    when (list.kind[i]) {
      DrawList.DOT -> canvas.drawCircle(x, y, list.size[i], paint)
      DrawList.TEXT -> canvas.drawText(list.text[i] ?: return, x, y, paint)
      else -> canvas.drawPath(line, paint)
    }
  }

  private companion object {
    val ALIGNS = arrayOf(Paint.Align.LEFT, Paint.Align.CENTER, Paint.Align.RIGHT)
  }
}

/** The bundled Atkinson Hyperlegible fonts (OFL, from packages/ui/fonts), loaded once per process; index = DrawList font. */
object Fonts {
  private var cache: Array<Typeface>? = null

  fun get(ctx: Context): Array<Typeface> = cache ?: arrayOf(
    "AtkinsonHyperlegibleNext_400Regular.ttf",
    "AtkinsonHyperlegibleNext_600SemiBold.ttf",
    "AtkinsonHyperlegibleMono_400Regular.ttf",
  ).map { Typeface.createFromAsset(ctx.applicationContext.assets, "fonts/$it") }.toTypedArray().also { cache = it }
}
