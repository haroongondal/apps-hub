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
import expo.modules.haloengine.core.lerpColor
import expo.modules.haloengine.core.mirror
import expo.modules.haloengine.core.point
import expo.modules.haloengine.core.withAlpha
import java.util.Random
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.sin

/** Lanterns tethered just inside the edge: each glows with its own band, flickers like a flame and sways gently. */
class Lantern : Pattern {
  override val id = "lantern"
  override val family = Family.LIGHTS
  private val e = EdgePoint()
  private val xy = FloatArray(2 * 2)
  private val rnd = Random(0x1A47E2L)
  private val lit = FloatArray(N)
  private val flick = FloatArray(N) { 1f }
  private var sway = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    val dt = input.dt
    val th = p.thicknessPx
    val decay = exp(-2f * dt)
    sway = (sway + dt * (0.3f + 1.5f * p.speed)) % (2f * PI.toFloat())
    val from = out.opCount
    for (i in 0 until N) {
      lit[i] = maxOf((band(input.spectrum.bands, (i + 0.5f) / N) * 1.7f).coerceAtMost(1f), lit[i] * decay)
      // Called every frame for every lantern so the random sequence never depends on the music.
      flick[i] += (0.7f + 0.3f * rnd.nextFloat() - flick[i]) * (12f * dt).coerceAtMost(1f)
      val a = lit[i] * flick[i]
      if (a < 0.02f) continue
      val swing = sin(sway + 1.7f * i)
      val u = (i + 0.5f + 0.25f * swing * (0.3f + 0.7f * p.spread)) / N
      val hang = th * (1.5f + 3f * p.spread) + th * 0.5f * cos(2f * sway + i)
      val col = input.color(i.toFloat() / N)
      input.point(u, 0f, e)
      xy[0] = e.x
      xy[1] = e.y
      input.point(u, hang, e)
      xy[2] = e.x
      xy[3] = e.y
      out.polyline(xy, 2, withAlpha(col, 0.3f * a), 1f + 0.1f * th, 0f, false)
      out.dot(e.x, e.y, th * (0.8f + 1.6f * a) * (0.6f + 0.8f * p.spread), withAlpha(col, 0.35f * a), input.glowPx * (1.5f + a))
      out.dot(e.x, e.y, th * 0.35f * (0.6f + 0.8f * a), withAlpha(lerpColor(col, 0xFFFFFFFF.toInt(), 0.5f), a), input.glowPx * 0.3f)
    }
    input.mirror(out, from, e)
  }

  private companion object {
    const val N = 8
  }
}
