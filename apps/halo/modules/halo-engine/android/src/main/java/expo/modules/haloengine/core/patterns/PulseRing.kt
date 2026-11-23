package expo.modules.haloengine.core.patterns

import expo.modules.haloengine.core.DrawList
import expo.modules.haloengine.core.EdgePoint
import expo.modules.haloengine.core.Family
import expo.modules.haloengine.core.FrameInput
import expo.modules.haloengine.core.Pattern
import expo.modules.haloengine.core.color
import expo.modules.haloengine.core.dt
import expo.modules.haloengine.core.glowPx
import expo.modules.haloengine.core.mirror
import expo.modules.haloengine.core.point
import expo.modules.haloengine.core.withAlpha
import kotlin.math.exp

/** The whole edge glows with the level; beats flare it and the palette slowly flows round. */
class PulseRing : Pattern {
  override val id = "pulse-ring"
  override val family = Family.LIGHTS
  private val e = EdgePoint()
  private val xy = FloatArray(2 * (PER + 1))
  private var pulse = 0f
  private var drift = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val dt = input.dt
    val p = input.params
    pulse = if (input.spectrum.beat) 1f else pulse * exp(-6f * dt)
    drift = (drift + dt * (0.02f + 0.2f * p.speed)) % 1f
    val energy = (input.spectrum.level * 1.5f + 0.5f * pulse).coerceAtMost(1f)
    if (energy < 0.02f) return
    val from = out.opCount
    val glow = input.glowPx * (0.6f + energy)
    ring(input, out, 0f, p.thicknessPx * (0.6f + 0.8f * energy + 0.6f * pulse), energy, glow)
    ring(input, out, p.thicknessPx * (1f + 4f * p.spread), p.thicknessPx * (0.4f + 1.2f * p.spread), 0.35f * energy, glow * 1.5f)
    input.mirror(out, from, e)
  }

  private fun ring(input: FrameInput, out: DrawList, inward: Float, width: Float, alpha: Float, glow: Float) {
    for (s in 0 until SEGMENTS) {
      for (k in 0..PER) {
        input.point((s * PER + k).toFloat() / (SEGMENTS * PER), inward, e)
        xy[2 * k] = e.x
        xy[2 * k + 1] = e.y
      }
      out.polyline(xy, PER + 1, withAlpha(input.color(s.toFloat() / SEGMENTS + drift), alpha), width, glow, false)
    }
  }

  private companion object {
    const val SEGMENTS = 16
    const val PER = 12
  }
}
