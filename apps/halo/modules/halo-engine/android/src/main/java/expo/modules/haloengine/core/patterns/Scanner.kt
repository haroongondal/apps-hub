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

/** A bright bar sweeps back and forth along the edge, easing at each end and leaving a fading afterimage. */
class Scanner : Pattern {
  override val id = "scanner"
  override val family = Family.LINES
  private val e = EdgePoint()
  private val xy = FloatArray(2 * (PER + 1))
  private var phase = 0f
  private var energy = 0f
  private var kick = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    val dt = input.dt
    energy = maxOf(input.spectrum.level, energy * exp(-1.5f * dt))
    kick = if (input.spectrum.beat) 1f else kick * exp(-5f * dt)
    phase = (phase + dt * (0.05f + 0.35f * p.speed) * (0.6f + 0.8f * energy)) % 2f
    if (energy < 0.02f) return
    val from = out.opCount
    val len = 0.03f + 0.09f * p.spread
    // Afterimages first, so the head draws on top; each samples the sweep a little earlier, reversals included.
    for (g in GHOSTS downTo 0) {
      val x = ((phase - g * LAG) % 2f + 2f) % 2f
      val tri = if (x < 1f) x else 2f - x
      val eased = tri * tri * (3f - 2f * tri)
      val start = eased * (1f - len)
      for (k in 0..PER) {
        input.point(start + len * k / PER, 0f, e)
        xy[2 * k] = e.x
        xy[2 * k + 1] = e.y
      }
      val f = 1f - g.toFloat() / (GHOSTS + 1)
      val head = g == 0
      val alpha = energy * f * f * (if (head) 1f else 0.5f)
      val width = p.thicknessPx * (0.8f + 0.6f * energy + 0.5f * kick) * (if (head) 1f else 0.7f)
      out.polyline(xy, PER + 1, withAlpha(input.color(0.5f * eased), alpha), width,
        if (head) input.glowPx * (1f + kick) else 0f, false)
    }
    input.mirror(out, from, e)
  }

  private companion object {
    const val GHOSTS = 6
    const val PER = 8
    const val LAG = 0.04f
  }
}
