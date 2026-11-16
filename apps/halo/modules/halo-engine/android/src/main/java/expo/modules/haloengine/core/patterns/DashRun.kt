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
import kotlin.math.exp

/** Dashes march round the edge like a lit marquee; each beat kicks them forward and each brightens with its band. */
class DashRun : Pattern {
  override val id = "dash-run"
  override val family = Family.LINES
  private val e = EdgePoint()
  private val xy = FloatArray(2 * 3)
  private var offset = 0f
  private var energy = 0f
  private var kick = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    val dt = input.dt
    energy = maxOf(input.spectrum.level, energy * exp(-1.5f * dt))
    kick = if (input.spectrum.beat) 1f else kick * exp(-5f * dt)
    offset = (offset + dt * (0.01f + 0.08f * p.speed) * (0.5f + energy + 3f * kick)) % 1f
    if (energy < 0.02f) return
    val from = out.opCount
    val pitch = 1f / DASHES
    val len = pitch * (0.25f + 0.6f * p.spread)
    val width = p.thicknessPx * (0.5f + 0.5f * energy + 0.5f * kick)
    for (i in 0 until DASHES) {
      val u0 = (i * pitch + offset) % 1f
      // Mirrored halves meet at the bottom: clip there so a dash does not spill into the other half.
      val u1 = if (p.mirrored) minOf(u0 + len, 1f) else u0 + len
      val b = band(input.spectrum.bands, fold((u0 + u1) * 0.5f % 1f))
      val alpha = energy * (0.3f + 0.7f * b)
      if (alpha < 0.02f) continue
      for (k in 0..2) {
        input.point(u0 + (u1 - u0) * k * 0.5f, 0f, e)
        xy[2 * k] = e.x
        xy[2 * k + 1] = e.y
      }
      out.polyline(xy, 3, withAlpha(input.color(i * pitch), alpha), width, input.glowPx * 0.4f * (b + kick), false)
    }
    input.mirror(out, from, e)
  }

  private companion object {
    const val DASHES = 36
  }
}
