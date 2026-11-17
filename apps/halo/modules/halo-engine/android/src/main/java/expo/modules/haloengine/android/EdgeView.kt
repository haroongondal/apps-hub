package expo.modules.haloengine.android

import android.content.Context
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.Shader
import android.os.SystemClock
import android.view.Choreographer
import android.view.RoundedCorner
import android.view.View
import expo.modules.haloengine.core.DrawList
import expo.modules.haloengine.core.EdgeEvents
import expo.modules.haloengine.core.EdgePath
import expo.modules.haloengine.core.FlashDecision
import expo.modules.haloengine.core.FrameInput
import expo.modules.haloengine.core.Pattern
import expo.modules.haloengine.core.PatternParams
import expo.modules.haloengine.core.Settings
import expo.modules.haloengine.core.SpectrumFrame
import expo.modules.haloengine.core.glowPx
import kotlin.math.ceil
import kotlin.math.roundToInt

/** Canvas renderer of a pattern's DrawList. Frames run only between [kick] and the fade-out after `animate` turns false. */
class EdgeView(ctx: Context, private val source: Source) : View(ctx) {
  interface Source {
    fun animate(nowMs: Long): Boolean
    fun spectrum(nowMs: Long): SpectrumFrame
  }

  private var input: FrameInput? = null
  private var settings = Settings()
  private var pattern: Pattern? = null
  private var colors = IntArray(0)
  private var path: EdgePath? = null
  private var params = PatternParams()
  private val list = DrawList()
  val events = EdgeEvents()
  private var musicOps = 0
  private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.BUTT
    strokeJoin = Paint.Join.ROUND
  }
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val line = Path()
  // Glow ops are recorded unblurred into one node that the GPU blurs in a single pass; the sharp node draws over it.
  private val glowNode = RenderNode("glow")
  private val sharpNode = RenderNode("sharp")
  private var glowing = false

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
      if (source.animate(now)) fadeStartMs = -1 else if (fadeStartMs < 0) fadeStartMs = now
      fade = if (fadeStartMs < 0) 1f else 1f - (now - fadeStartMs).toFloat() / FADE_MS
      invalidate()
      if (fade > 0f || events.active(now)) {
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

  /** Colour-only swap (art or wallpaper changed): no relayout. */
  fun setColors(colors: IntArray) {
    this.colors = colors
    invalidate()
  }

  fun kick() {
    if (looping || path == null || visibility != VISIBLE) return
    looping = true
    fadeStartMs = -1
    lastDrawMs = -1
    ProbeLog.log(context, "frame", "loop started frames=$frames")
    choreographer.postFrameCallback(tick)
  }

  fun flash(d: FlashDecision, colour: Int) {
    events.flash(d, colour, SystemClock.uptimeMillis())
    kickEvents()
  }

  // A flash alone must not wake the music pattern, so a loop it starts begins with the music fade already over.
  private fun kickEvents() {
    if (looping) return
    kick()
    val now = SystemClock.uptimeMillis()
    if (looping && !source.animate(now)) fadeStartMs = now - FADE_MS
  }

  fun stop() {
    choreographer.removeFrameCallback(tick)
    looping = false
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    ProbeLog.log(context, "overlay", "view attached hardwareAccelerated=$isHardwareAccelerated")
  }

  override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
    rebuild()
    if (events.active(SystemClock.uptimeMillis())) kickEvents()
  }

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
    // One blur radius per settings change, not per op or per frame: per-op glow keeps its alpha, the spread is shared.
    val r = params.glowPx
    glowing = r >= 1f
    val b = r / GLOW_SCALE
    glowNode.setRenderEffect(if (glowing) RenderEffect.createBlurEffect(b, b, Shader.TileMode.DECAL) else null)
    // The glow is blurred anyway, so it is recorded and blurred at 1/GLOW_SCALE size and scaled up when drawn.
    glowNode.setPosition(0, 0, ceil(width / GLOW_SCALE).toInt(), ceil(height / GLOW_SCALE).toInt())
    glowNode.setPivotX(0f)
    glowNode.setPivotY(0f)
    glowNode.setScaleX(GLOW_SCALE)
    glowNode.setScaleY(GLOW_SCALE)
    sharpNode.setPosition(0, 0, width, height)
    ProbeLog.log(context, "overlay", "path ${width}x$height auto=${e.auto} corners=${corners.joinToString(",") { it.roundToInt().toString() }} insets=${insets.joinToString(",") { it.roundToInt().toString() }} pattern=${pattern?.id}")
  }

  override fun onDraw(canvas: Canvas) {
    val path = path ?: return
    val pattern = pattern ?: return
    if (!looping) return
    val t0 = System.nanoTime()
    val now = SystemClock.uptimeMillis()
    val dt = if (lastDrawMs < 0) 16L else now - lastDrawMs
    lastDrawMs = now
    val s = source.spectrum(now)
    val input = input?.also {
      it.path = path; it.spectrum = s; it.timeMs = now; it.dtMs = dt; it.params = params; it.colors = colors
    } ?: FrameInput(path, s, now, dt, params, colors).also { input = it }
    list.clear()
    if (fade > 0f) pattern.draw(input, list)
    // A beat belongs to one FFT frame, but several draw frames fall between FFT frames: patterns see it once.
    s.beat = false
    musicOps = list.opCount
    events.draw(path, params, now, list)
    render(canvas)
    record((System.nanoTime() - t0) / 1e6f, now)
  }

  private fun render(canvas: Canvas) {
    // RenderNodes need a hardware canvas; a software one gets the sharp pass only.
    val hw = canvas.isHardwareAccelerated
    val glowCanvas = if (hw && glowing) glowNode.beginRecording().apply { scale(1f / GLOW_SCALE, 1f / GLOW_SCALE) } else null
    val sharpCanvas = if (hw) sharpNode.beginRecording() else canvas
    val pts = list.points
    for (i in 0 until list.opCount) {
      val dot = list.kind[i] == DrawList.DOT
      val paint = if (dot) fill else stroke
      paint.color = list.color[i]
      if (i < musicOps && fade < 1f) paint.alpha = (paint.alpha * fade).toInt()
      val at = list.start[i]
      if (!dot) {
        paint.strokeWidth = list.size[i]
        line.rewind()
        line.moveTo(pts[at], pts[at + 1])
        for (k in 1 until list.count[i]) line.lineTo(pts[at + 2 * k], pts[at + 2 * k + 1])
        if (list.closed[i]) line.close()
      }
      // A blurred pass alone washes the line out to a faint haze, so the sharp shape is drawn over its glow.
      if (glowCanvas != null && list.glow[i] >= 0.5f) draw(glowCanvas, dot, paint, pts[at], pts[at + 1], list.size[i])
      draw(sharpCanvas, dot, paint, pts[at], pts[at + 1], list.size[i])
    }
    if (!hw) return
    if (glowCanvas != null) {
      glowNode.endRecording()
      canvas.drawRenderNode(glowNode)
    }
    sharpNode.endRecording()
    canvas.drawRenderNode(sharpNode)
  }

  private fun draw(canvas: Canvas, dot: Boolean, paint: Paint, x: Float, y: Float, radius: Float) {
    if (dot) canvas.drawCircle(x, y, radius, paint) else canvas.drawPath(line, paint)
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
    const val GLOW_SCALE = 4f
    val CORNERS = intArrayOf(
      RoundedCorner.POSITION_TOP_LEFT,
      RoundedCorner.POSITION_TOP_RIGHT,
      RoundedCorner.POSITION_BOTTOM_RIGHT,
      RoundedCorner.POSITION_BOTTOM_LEFT,
    )
  }
}
