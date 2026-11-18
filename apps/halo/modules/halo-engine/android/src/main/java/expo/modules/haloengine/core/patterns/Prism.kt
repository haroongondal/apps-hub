package expo.modules.haloengine.core.patterns

import expo.modules.haloengine.core.DrawList
import expo.modules.haloengine.core.EdgePoint
import expo.modules.haloengine.core.Family
import expo.modules.haloengine.core.FrameInput
import expo.modules.haloengine.core.Pattern
import expo.modules.haloengine.core.band
import expo.modules.haloengine.core.color
import expo.modules.haloengine.core.dt
import expo.modules.haloengine.core.glowPx
import expo.modules.haloengine.core.mirror
import expo.modules.haloengine.core.point
import expo.modules.haloengine.core.withAlpha
import kotlin.math.exp

/** Light split three ways: parallel strands of shifted colour run in facets, each lit by its band, fanning apart as it gets louder. */
class Prism : Pattern {
  override val id = "prism"
  override val family = Family.LIGHTS
  private val e = EdgePoint()
  private val xy = FloatArray(2 * (PER + 1))
  private val energy = FloatArray(FACETS)
  private var fan = 0f
  private var drift = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    val dt = input.dt
    val decay = exp(-2.5f * dt)
    drift = (drift + dt * (0.01f + 0.1f * p.speed)) % 1f
    fan = maxOf((input.spectrum.level * 1.6f).coerceAtMost(1f), fan * decay)
    for (f in 0 until FACETS) {
      energy[f] = maxOf((band(input.spectrum.bands, (f + 0.5f) / FACETS) * 1.6f).coerceAtMost(1f), energy[f] * decay)
    }
    val th = p.thicknessPx
    val sep = th * (0.3f + (0.6f + 1.6f * p.spread) * fan)
    val from = out.opCount
    for (f in 0 until FACETS) {
      val v = energy[f]
      if (v < 0.02f) continue
      for (s in 0 until STRANDS) {
        for (k in 0..PER) {
          input.point((f + GAP + (1f - 2f * GAP) * k / PER) / FACETS, s * sep, e)
          xy[2 * k] = e.x
          xy[2 * k + 1] = e.y
        }
        val col = withAlpha(input.color(0.5f * f / FACETS + s.toFloat() / STRANDS + drift), v * (1f - 0.25f * s))
        // Only the outer strand glows: blurred ops are the costly ones on the phone.
        out.polyline(xy, PER + 1, col, th * (0.25f + 0.5f * v), if (s == 0) input.glowPx * 0.6f * v else 0f, false)
      }
    }
    input.mirror(out, from, e)
  }

  private companion object {
    const val FACETS = 16
    const val STRANDS = 3
    const val PER = 8
    const val GAP = 0.06f
  }
}
