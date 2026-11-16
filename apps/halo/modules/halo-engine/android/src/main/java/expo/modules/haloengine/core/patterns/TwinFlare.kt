package expo.modules.haloengine.core.patterns

import expo.modules.haloengine.core.DrawList
import expo.modules.haloengine.core.EdgePoint
import expo.modules.haloengine.core.Family
import expo.modules.haloengine.core.FrameInput
import expo.modules.haloengine.core.Pattern
import expo.modules.haloengine.core.color
import expo.modules.haloengine.core.dt
import expo.modules.haloengine.core.glowPx
import expo.modules.haloengine.core.lerpColor
import expo.modules.haloengine.core.mirror
import expo.modules.haloengine.core.point
import expo.modules.haloengine.core.withAlpha
import kotlin.math.abs
import kotlin.math.exp

/** Two flares face each other across the screen and slowly orbit: bass swells one, treble the other, beats flash them white. */
class TwinFlare : Pattern {
  override val id = "twin-flare"
  override val family = Family.LIGHTS
  private val e = EdgePoint()
  private val xy = FloatArray(2 * 3)
  private var head = 0f
  private var lo = 0f
  private var hi = 0f
  private var flash = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    val dt = input.dt
    val bands = input.spectrum.bands
    val n = bands.size
    var bass = 0f
    var treble = 0f
    for (b in 0 until n / 4) bass += bands[b]
    for (b in n / 2 until n) treble += bands[b]
    bass = (bass / (n / 4).coerceAtLeast(1) * 1.5f).coerceAtMost(1f)
    treble = (treble / (n - n / 2).coerceAtLeast(1) * 2f).coerceAtMost(1f)
    lo = maxOf(bass, lo * exp(-3f * dt))
    hi = maxOf(treble, hi * exp(-3f * dt))
    flash = if (input.spectrum.beat) 1f else flash * exp(-8f * dt)
    head = (head + dt * (0.01f + 0.08f * p.speed)) % 1f
    val from = out.opCount
    flare(input, out, head, lo, input.color(head))
    flare(input, out, head + 0.5f, hi, input.color(head + 0.5f))
    input.mirror(out, from, e)
  }

  private fun flare(input: FrameInput, out: DrawList, c: Float, v: Float, col: Int) {
    if (v < 0.02f) return
    val p = input.params
    val span = (0.02f + 0.1f * p.spread) * (0.3f + 0.7f * v)
    for (s in -SEG until SEG) {
      for (k in 0..2) {
        input.point(c + span * (s + k / 2f) / SEG, 0f, e)
        xy[2 * k] = e.x
        xy[2 * k + 1] = e.y
      }
      val f = 1f - abs(s + 0.5f) / SEG
      out.polyline(xy, 3, withAlpha(col, v * f * f), p.thicknessPx * (0.4f + 1.6f * v) * (0.3f + 0.7f * f), input.glowPx * f, false)
    }
    input.point(c, 0f, e)
    val hot = lerpColor(col, 0xFFFFFFFF.toInt(), 0.25f + 0.6f * flash)
    out.dot(e.x, e.y, p.thicknessPx * (0.5f + v + flash), withAlpha(hot, v), input.glowPx * (1.5f + flash))
  }

  private companion object {
    const val SEG = 6
  }
}
