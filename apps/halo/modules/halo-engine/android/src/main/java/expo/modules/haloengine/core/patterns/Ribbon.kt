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
import expo.modules.haloengine.core.lerpColor
import expo.modules.haloengine.core.mirror
import expo.modules.haloengine.core.point
import expo.modules.haloengine.core.withAlpha
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

/** A satin ribbon floats along the edge, twisting so its face narrows and flips colour; the music lifts it in waves. */
class Ribbon : Pattern {
  override val id = "ribbon"
  override val family = Family.WAVES
  private val e = EdgePoint()
  private val xy = FloatArray(2 * (PER + 1))
  private var twist = 0f
  private var flow = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    val dt = input.dt
    twist = (twist + dt * (0.04f + 0.5f * p.speed)) % 1f
    flow = (flow + dt * (0.02f + 0.15f * p.speed)) % 1f
    val level = input.spectrum.level
    if (level < 0.01f) return
    val from = out.opCount
    val th = p.thicknessPx
    val wide = th * (1.6f + 1.4f * p.spread)
    val lift = th * (0.5f + 2.5f * p.spread)
    val bands = input.spectrum.bands
    val alpha = (0.35f + level).coerceAtMost(1f)
    val front = input.color(flow)
    val back = input.color(flow + 0.5f)
    for (s in 0 until SEGMENTS) {
      for (k in 0..PER) {
        val u = (s * PER + k).toFloat() / (SEGMENTS * PER)
        val swing = 0.5f + 0.5f * sin(2f * PI.toFloat() * (3f * u + flow))
        input.point(u, wide * 0.5f + lift * swing * (0.3f + band(bands, fold(u))), e)
        xy[2 * k] = e.x
        xy[2 * k + 1] = e.y
      }
      val mid = (s + 0.5f) / SEGMENTS
      val c = cos(2f * PI.toFloat() * (TWISTS * mid - twist))
      val face = abs(c)
      val col = lerpColor(back, front, 0.5f + 0.5f * c)
      // Only the broad, front-facing stretches glow: blurred ops are the costly ones on the phone.
      val glow = if (c > 0.6f) input.glowPx * (c - 0.6f) * 2.5f else 0f
      out.polyline(xy, PER + 1, withAlpha(col, alpha * (0.45f + 0.55f * face)), wide * (0.12f + 0.88f * face), glow, false)
    }
    input.mirror(out, from, e)
  }

  private companion object {
    const val SEGMENTS = 96
    const val PER = 4
    const val TWISTS = 7f
  }
}
