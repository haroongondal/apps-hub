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

/** Bars stand inward from the edge, bass to treble along the travel direction; colour flows along them. */
class SpectrumRim : Pattern {
  override val id = "spectrum-rim"
  override val family = Family.LINES
  private val e = EdgePoint()
  private val xy = FloatArray(4)
  private var drift = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    drift = (drift + input.dt * (0.02f + 0.3f * p.speed)) % 1f
    val maxLen = input.path.length * (0.004f + 0.016f * p.spread)
    val from = out.opCount
    for (i in 0 until BARS) {
      val u = (i + 0.5f) / BARS
      val v = band(input.spectrum.bands, u)
      if (v < 0.02f) continue
      input.point(u, 0f, e)
      xy[0] = e.x
      xy[1] = e.y
      xy[2] = e.x + e.nx * v * maxLen
      xy[3] = e.y + e.ny * v * maxLen
      out.polyline(xy, 2, withAlpha(input.color(u + drift), 0.4f + 0.6f * v), p.thicknessPx * 0.7f, input.glowPx * (0.3f + 0.7f * v), false)
    }
    input.mirror(out, from, e)
  }

  private companion object {
    const val BARS = 96
  }
}
