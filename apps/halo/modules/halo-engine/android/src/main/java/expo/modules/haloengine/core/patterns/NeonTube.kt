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
import java.util.Random
import kotlin.math.exp

/** A neon tube lights round the edge from the top like a level meter: white-hot core, coloured halo, beats make it flicker. */
class NeonTube : Pattern {
  override val id = "neon-tube"
  override val family = Family.LINES
  private val e = EdgePoint()
  private val xy = FloatArray(2 * (PER + 1))
  private val flick = FloatArray(SEG)
  private val rnd = Random(0x4E30L)
  private var fill = 0f
  private var drift = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    val dt = input.dt
    fill = maxOf((input.spectrum.level * 1.6f).coerceAtMost(1f), fill * exp(-(1.5f + 2f * p.speed) * dt))
    drift = (drift + dt * (0.01f + 0.1f * p.speed)) % 1f
    for (s in 0 until SEG) flick[s] = (flick[s] - 6f * dt).coerceAtLeast(0f)
    if (input.spectrum.beat) repeat(3) { flick[rnd.nextInt(SEG)] = 1f }
    if (fill < 0.02f) return
    val from = out.opCount
    val haloWidth = p.thicknessPx * (1.4f + 1.6f * p.spread)
    val inward = haloWidth * 0.5f
    for (s in 0 until SEG) {
      val u0 = s.toFloat() / SEG
      if (u0 >= fill) break
      val u1 = minOf((s + 1f) / SEG, fill)
      for (k in 0..PER) {
        input.point(u0 + (u1 - u0) * k / PER, inward, e)
        xy[2 * k] = e.x
        xy[2 * k + 1] = e.y
      }
      val dim = 1f - 0.85f * flick[s]
      val c = input.color(0.3f * u0 + drift)
      out.polyline(xy, PER + 1, withAlpha(c, 0.45f * dim * (0.4f + 0.6f * fill)), haloWidth, input.glowPx * 1.2f, false)
      out.polyline(xy, PER + 1, withAlpha(lerpColor(c, WHITE, 0.7f), dim * (0.6f + 0.4f * fill)), p.thicknessPx * 0.35f, 0f, false)
    }
    input.point(fill, inward, e)
    out.dot(e.x, e.y, p.thicknessPx * 0.5f, withAlpha(WHITE, fill), input.glowPx)
    input.mirror(out, from, e)
  }

  private companion object {
    const val SEG = 24
    const val PER = 8
    const val WHITE = 0xFFFFFFFF.toInt()
  }
}
