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

/** Thick bars float on a line just inside the edge and grow both ways from it; bass sits at the ends, treble mid-way. */
class MirrorBars : Pattern {
  override val id = "mirror-bars"
  override val family = Family.LINES
  private val e = EdgePoint()
  private val xy = FloatArray(4)
  private var drift = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    drift = (drift + input.dt * (0.01f + 0.15f * p.speed)) % 1f
    val half = input.path.length * (0.003f + 0.012f * p.spread)
    val from = out.opCount
    for (i in 0 until BARS) {
      val u = (i + 0.5f) / BARS
      val v = band(input.spectrum.bands, fold(u))
      if (v < 0.03f) continue
      input.point(u, half * (1f - v), e)
      xy[0] = e.x
      xy[1] = e.y
      xy[2] = e.x + e.nx * 2f * v * half
      xy[3] = e.y + e.ny * 2f * v * half
      out.polyline(xy, 2, withAlpha(input.color(0.5f * fold(u) + drift), 0.35f + 0.65f * v),
        p.thicknessPx * (0.6f + 0.8f * v), input.glowPx * 0.5f * v, false)
    }
    input.mirror(out, from, e)
  }

  private companion object {
    const val BARS = 56
  }
}
