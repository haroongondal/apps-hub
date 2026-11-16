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
import kotlin.math.pow

/** A bright head with a tapering tail races round the edge; louder music drives it faster. */
class Comet : Pattern {
  override val id = "comet"
  override val family = Family.LINES
  private val e = EdgePoint()
  private val xy = FloatArray(2 * 3)
  private var head = 0f
  private var energy = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    val dt = input.dt
    energy = maxOf(input.spectrum.level, energy * exp(-1.5f * dt))
    head = (head + dt * (0.04f + 0.5f * energy) * (0.3f + 1.4f * p.speed)) % 1f
    if (energy < 0.02f) return
    val from = out.opCount
    val tail = 0.06f + 0.24f * p.spread
    val glow = input.glowPx
    for (s in 0 until SEG) {
      val a = s.toFloat() / SEG
      for (k in 0..2) {
        input.point(head - tail * (a + k / (2f * SEG)), 0f, e)
        xy[2 * k] = e.x
        xy[2 * k + 1] = e.y
      }
      val f = 1f - a
      val width = p.thicknessPx * (0.3f + 0.9f * f) * (0.7f + 0.6f * energy)
      out.polyline(xy, 3, withAlpha(input.color(a * 0.5f), energy * f.pow(1.5f)), width, glow * f, false)
    }
    input.point(head, 0f, e)
    out.dot(e.x, e.y, p.thicknessPx * (0.8f + energy), withAlpha(input.color(0f), energy), glow * 1.5f)
    input.mirror(out, from, e)
  }

  private companion object {
    const val SEG = 16
  }
}
