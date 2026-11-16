package expo.modules.haloengine.android

import android.content.Context
import android.content.res.Configuration
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.os.SystemClock
import android.util.SparseArray
import android.view.Choreographer
import android.view.RoundedCorner
import android.view.View
import expo.modules.haloengine.core.DrawList
import expo.modules.haloengine.core.EdgePath
import expo.modules.haloengine.core.FrameInput
import expo.modules.haloengine.core.Pattern
import expo.modules.haloengine.core.PatternParams
import expo.modules.haloengine.core.Settings
import expo.modules.haloengine.core.SpectrumFrame
import kotlin.math.ceil
import kotlin.math.roundToInt

/** Canvas renderer of a pattern's DrawList. Frames run only between [kick] and the fade-out after `animate` turns false. */
class EdgeView(
  ctx: Context,
  private val animate: (Long) -> Boolean,
  private val spectrum: (Long) -> SpectrumFrame,
) : View(ctx) {
  private var settings = Settings()
  private var pattern: Pattern? = null
  private var colors = IntArray(0)
  private var path: EdgePath? = null
  private var params = PatternParams()
  private val list = DrawList()
  private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.BUTT
    strokeJoin = Paint.Join.ROUND
  }
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val line = Path()
  private val blurs = SparseArray<BlurMaskFilter>()

  private val choreographer = Choreographer.getInstance()
  private var looping = false
  private var fadeStartMs = -1L
  private var fade = 0f
  private var lastDrawMs = -1L

  private val times = FloatArray(WINDOW)
  private val sorted = FloatArray(WINDOW)
  private var timeCount = 0
  private var timeAt = 0
  private var frames = 0L
  private var lastLogMs = 0L

  private val tick = object : Choreographer.FrameCallback {
    override fun doFrame(frameTimeNanos: Long) {
      val now = SystemClock.uptimeMillis()
      if (animate(now)) fadeStartMs = -1 else if (fadeStartMs < 0) fadeStartMs = now
      fade = if (fadeStartMs < 0) 1f else 1f - (now - fadeStartMs).toFloat() / FADE_MS
      invalidate()
      if (fade > 0f) {
        choreographer.postFrameCallback(this)
      } else {
        looping = false
        ProbeLog.log(context, "frame", "loop stopped frames=$frames p95=${fmt(p95())}")
      }
    }
  }

  fun apply(s: Settings, pattern: Pattern, colors: IntArray) {
    settings = s
    this.pattern = pattern
    this.colors = colors
    rebuild()
    invalidate()
  }

  fun kick() {
    if (looping || path == null) return
    looping = true
    fadeStartMs = -1
    lastDrawMs = -1
    ProbeLog.log(context, "frame", "loop started frames=$frames")
    choreographer.postFrameCallback(tick)
  }

  fun stop() {
    choreographer.removeFrameCallback(tick)
    looping = false
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    ProbeLog.log(context, "overlay", "view attached hardwareAccelerated=$isHardwareAccelerated")
  }

  override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) = rebuild()

  override fun onConfigurationChanged(newConfig: Configuration?) {
    super.onConfigurationChanged(newConfig)
    rebuild()
  }

  private fun rebuild() {
    if (width == 0 || height == 0) return
    val density = resources.displayMetrics.density
    val p = settings.params
    val e = settings.edges
    val round = p.roundness.toFloat()
    val d = display
    val corners = if (e.auto) {
      FloatArray(4) { (d?.getRoundedCorner(CORNERS[it])?.radius ?: 0) * round }
    } else {
      FloatArray(4) { e.corners[it] * round }
    }
    val insets = if (e.auto) FloatArray(4) else FloatArray(4) { e.insets[it].toFloat() }
    path = EdgePath(width.toFloat(), height.toFloat(), corners, insets)
    params = PatternParams(
      thicknessPx = p.thickness.toFloat() * density,
      speed = p.speed.toFloat(),
      spread = p.spread.toFloat(),
      glow = p.glow.toFloat(),
      paddingPx = p.padding.toFloat() * density,
      roundness = round,
      mirrored = p.mirrored,
      clockwise = p.clockwise,
    )
    ProbeLog.log(context, "overlay", "path ${width}x$height auto=${e.auto} corners=${corners.joinToString(",") { it.roundToInt().toString() }} insets=${insets.joinToString(",") { it.roundToInt().toString() }} pattern=${pattern?.id}")
  }

  override fun onDraw(canvas: Canvas) {
    val path = path ?: return
    val pattern = pattern ?: return
    if (!looping || fade <= 0f) return
    val t0 = System.nanoTime()
    val now = SystemClock.uptimeMillis()
    val dt = if (lastDrawMs < 0) 16L else now - lastDrawMs
    lastDrawMs = now
    val s = spectrum(now)
    list.clear()
    pattern.draw(FrameInput(path, s, now, dt, params, colors), list)
    // A beat belongs to one FFT frame, but several draw frames fall between FFT frames: patterns see it once.
    s.beat = false
    render(canvas)
    record((System.nanoTime() - t0) / 1e6f, now)
  }

  private fun render(canvas: Canvas) {
    val pts = list.points
    for (i in 0 until list.opCount) {
      val dot = list.kind[i] == DrawList.DOT
      val paint = if (dot) fill else stroke
      paint.color = list.color[i]
      if (fade < 1f) paint.alpha = (paint.alpha * fade).toInt()
      val at = list.start[i]
      if (!dot) {
        paint.strokeWidth = list.size[i]
        line.rewind()
        line.moveTo(pts[at], pts[at + 1])
        for (k in 1 until list.count[i]) line.lineTo(pts[at + 2 * k], pts[at + 2 * k + 1])
        if (list.closed[i]) line.close()
      }
      // A blurred pass alone washes the line out to a faint haze, so the sharp shape is drawn over its glow.
      val glow = blur(list.glow[i])
      if (glow != null) {
        paint.maskFilter = glow
        draw(canvas, dot, paint, pts[at], pts[at + 1], list.size[i])
        paint.maskFilter = null
      }
      draw(canvas, dot, paint, pts[at], pts[at + 1], list.size[i])
    }
  }

  private fun draw(canvas: Canvas, dot: Boolean, paint: Paint, x: Float, y: Float, radius: Float) {
    if (dot) canvas.drawCircle(x, y, radius, paint) else canvas.drawPath(line, paint)
  }

  private fun blur(glowPx: Float): BlurMaskFilter? {
    val r = glowPx.roundToInt()
    if (r < 1) return null
    return blurs.get(r) ?: BlurMaskFilter(r.toFloat(), BlurMaskFilter.Blur.NORMAL).also { blurs.put(r, it) }
  }

  private fun record(ms: Float, now: Long) {
    times[timeAt] = ms
    timeAt = (timeAt + 1) % WINDOW
    if (timeCount < WINDOW) timeCount++
    frames++
    if (frames % 30 == 0L) HaloService.frameP95Ms = p95().toDouble()
    if (now - lastLogMs >= 10_000) {
      lastLogMs = now
      ProbeLog.log(context, "frame", "p95=${fmt(p95())} ops=${list.opCount} frames=$frames pattern=${pattern?.id}")
    }
  }

  private fun p95(): Float {
    if (timeCount == 0) return 0f
    times.copyInto(sorted, 0, 0, timeCount)
    sorted.sort(0, timeCount)
    return sorted[ceil(timeCount * 0.95f).toInt() - 1]
  }

  private fun fmt(ms: Float) = "%.2fms".format(ms)

  private companion object {
    const val WINDOW = 120
    const val FADE_MS = 600L
    val CORNERS = intArrayOf(
      RoundedCorner.POSITION_TOP_LEFT,
      RoundedCorner.POSITION_TOP_RIGHT,
      RoundedCorner.POSITION_BOTTOM_RIGHT,
      RoundedCorner.POSITION_BOTTOM_LEFT,
    )
  }
}
