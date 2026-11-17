package expo.modules.haloengine.core

import kotlin.math.PI
import kotlin.math.floor
import kotlin.math.sin

/** Notification flashes over the music pattern: at most `cap`, one per app, oldest dropped; allocates only in [flash]. */
class EdgeEvents(cap: Int = 8) {
  private class Slot {
    var pkg = ""
    var colour = 0
    var style = ""
    var repeat = 1
    var durationMs = 0L
    var startMs = 0L
    var lastMs = 0L
    var lastRep = -1
    var patternStyle = ""
    var pattern: Pattern? = null
    val colours = IntArray(1)
  }

  private val slots = Array(cap.coerceAtLeast(1)) { Slot() }
  private val e = EdgePoint()
  private val xy = FloatArray(2 * RIM)
  private val spectrum = SpectrumFrame(FloatArray(BANDS), 0f, false)
  private var input: FrameInput? = null

  fun flash(d: FlashDecision, colour: Int, nowMs: Long) {
    val s = slots.firstOrNull { it.pkg == d.pkg } ?: slots.firstOrNull { !live(it, nowMs) } ?: slots.minBy { it.startMs }
    s.pkg = d.pkg
    s.colour = colour
    s.colours[0] = colour
    s.style = d.style
    s.repeat = d.repeat.coerceAtLeast(1)
    s.durationMs = d.durationMs.coerceAtLeast(1L)
    s.startMs = nowMs
    s.lastMs = nowMs
    s.lastRep = -1
    if (d.style != PULSE && d.style != SWEEP && s.patternStyle != d.style) {
      s.pattern = Patterns.create(d.style)
      s.patternStyle = d.style
    }
  }

  fun active(nowMs: Long): Boolean = slots.any { live(it, nowMs) }

  fun draw(path: EdgePath, params: PatternParams, nowMs: Long, out: DrawList) {
    for (s in slots) {
      if (!live(s, nowMs)) continue
      val f = ((nowMs - s.startMs).toFloat() / s.durationMs).coerceAtLeast(0f)
      when (s.style) {
        PULSE -> pulse(s, f, path, params, out)
        SWEEP -> sweep(s, f, path, params, out)
        else -> pattern(s, f, path, params, nowMs, out)
      }
      s.lastMs = nowMs
    }
  }

  private fun live(s: Slot, nowMs: Long) = nowMs - s.startMs < s.durationMs

  private fun point(path: EdgePath, params: PatternParams, t: Float) {
    path.at(t, e)
    e.x += e.nx * params.paddingPx
    e.y += e.ny * params.paddingPx
  }

  private fun pulse(s: Slot, f: Float, path: EdgePath, params: PatternParams, out: DrawList) {
    val a = sin(PI.toFloat() * f * s.repeat)
    val env = a * a
    if (env < 0.02f) return
    for (k in 0 until RIM) {
      point(path, params, k.toFloat() / RIM)
      xy[2 * k] = e.x
      xy[2 * k + 1] = e.y
    }
    out.polyline(xy, RIM, withAlpha(s.colour, env), params.thicknessPx * (0.6f + 0.6f * env), params.glowPx * (0.5f + env), true)
  }

  private fun sweep(s: Slot, f: Float, path: EdgePath, params: PatternParams, out: DrawList) {
    val x = f * s.repeat
    val head = x - floor(x)
    val dir = if (params.clockwise) 1f else -1f
    for (g in 0 until TAIL_SEGS) {
      for (k in 0..PER) {
        val back = (g * PER + k).toFloat() / (TAIL_SEGS * PER) * TAIL
        point(path, params, dir * (head - back))
        xy[2 * k] = e.x
        xy[2 * k + 1] = e.y
      }
      val fade = 1f - g.toFloat() / TAIL_SEGS
      out.polyline(xy, PER + 1, withAlpha(s.colour, fade), params.thicknessPx * (0.5f + 0.7f * fade), params.glowPx * fade, false)
    }
  }

  // Any edge pattern, driven by a synthetic spectrum that swells once per repeat with a beat at each start.
  private fun pattern(s: Slot, f: Float, path: EdgePath, params: PatternParams, nowMs: Long, out: DrawList) {
    val p = s.pattern ?: return
    val x = f * s.repeat
    val rep = x.toInt()
    val env = sin(PI.toFloat() * (x - rep))
    for (i in spectrum.bands.indices) spectrum.bands[i] = env * (1f - 0.5f * i / BANDS)
    spectrum.level = env
    spectrum.beat = rep != s.lastRep
    s.lastRep = rep
    val dt = if (nowMs > s.lastMs) nowMs - s.lastMs else 16L
    val input = input?.also {
      it.path = path; it.spectrum = spectrum; it.timeMs = nowMs; it.dtMs = dt; it.params = params; it.colors = s.colours
    } ?: FrameInput(path, spectrum, nowMs, dt, params, s.colours).also { input = it }
    p.draw(input, out)
  }

  private companion object {
    const val PULSE = "pulse"
    const val SWEEP = "sweep"
    const val RIM = 192
    const val TAIL = 0.2f
    const val TAIL_SEGS = 8
    const val PER = 4
    const val BANDS = 32
  }
}
