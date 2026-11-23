package expo.modules.haloengine.core.patterns

import expo.modules.haloengine.core.DrawList
import expo.modules.haloengine.core.EdgePoint
import expo.modules.haloengine.core.Family
import expo.modules.haloengine.core.FrameInput
import expo.modules.haloengine.core.Pattern
import expo.modules.haloengine.core.band
import expo.modules.haloengine.core.color
import expo.modules.haloengine.core.dt
import expo.modules.haloengine.core.fold
import expo.modules.haloengine.core.glowPx
import expo.modules.haloengine.core.mirror
import expo.modules.haloengine.core.point
import expo.modules.haloengine.core.withAlpha
import kotlin.math.PI
import kotlin.math.sin

/** Two waves travel round the edge in opposite directions, swelling inward where their bands are loud. */
class Ripple : Pattern {
  override val id = "ripple"
  override val family = Family.WAVES
  private val e = EdgePoint()
  private val xy = FloatArray(2 * (PER + 1))
  private var p1 = 0f
  private var p2 = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    val dt = input.dt
    p1 = (p1 + dt * (0.2f + 1.2f * p.speed)) % 1f
    p2 = (p2 + dt * (0.13f + 0.8f * p.speed)) % 1f
    val level = input.spectrum.level
    if (level < 0.01f) return
    val from = out.opCount
    val maxAmp = input.path.length * (0.004f + 0.016f * p.spread)
    wave(input, out, 10f, p1, maxAmp, p.thicknessPx, 0.4f + 0.6f * level, input.glowPx, 0f)
    wave(input, out, 7f, -p2, maxAmp * 0.6f, p.thicknessPx * 0.5f, 0.2f + 0.4f * level, input.glowPx * 0.6f, 0.5f)
    input.mirror(out, from, e)
  }

  private fun wave(input: FrameInput, out: DrawList, cycles: Float, phase: Float, amp: Float, width: Float,
                   alpha: Float, glow: Float, hue: Float) {
    val bands = input.spectrum.bands
    for (s in 0 until SEGMENTS) {
      for (k in 0..PER) {
        val u = (s * PER + k).toFloat() / (SEGMENTS * PER)
        val off = band(bands, fold(u)) * amp * (0.5f + 0.5f * sin(2f * PI.toFloat() * (cycles * u - phase)))
        input.point(u, off, e)
        xy[2 * k] = e.x
        xy[2 * k + 1] = e.y
      }
      out.polyline(xy, PER + 1, withAlpha(input.color(hue + s.toFloat() / SEGMENTS), alpha), width, glow, false)
    }
  }

  private companion object {
    const val SEGMENTS = 16
    const val PER = 12
  }
}
