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
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/** Two strands twist round each other along the edge like a double helix; loud bands light the rungs between them. */
class Helix : Pattern {
  override val id = "helix"
  override val family = Family.WAVES
  private val e = EdgePoint()
  private val xy = FloatArray(2 * (PER + 1))
  private var phase = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    phase = (phase + input.dt * (0.05f + 0.6f * p.speed)) % 1f
    val level = input.spectrum.level
    if (level < 0.01f) return
    val from = out.opCount
    val amp = p.thicknessPx * (0.8f + 2.2f * p.spread) * (0.5f + 0.5f * (2f * level).coerceAtMost(1f))
    val centre = amp + p.thicknessPx * 0.5f
    strand(input, out, centre, amp, 0f, level)
    strand(input, out, centre, amp, 0.5f, level)
    val bands = input.spectrum.bands
    for (r in 0 until RUNGS) {
      val u = (r + 0.5f) / RUNGS
      val v = band(bands, fold(u))
      if (v < 0.08f) continue
      val s = sin(angle(u))
      input.point(u, centre + amp * s, e)
      xy[0] = e.x; xy[1] = e.y
      input.point(u, centre - amp * s, e)
      xy[2] = e.x; xy[3] = e.y
      out.polyline(xy, 2, withAlpha(input.color(u + 0.25f), 0.5f * v), p.thicknessPx * 0.25f, 0f, false)
    }
    input.mirror(out, from, e)
  }

  private fun angle(u: Float) = 2f * PI.toFloat() * (TWISTS * u - phase)

  // `half` = 0.5 puts the second strand half a turn behind; only the front half of each turn glows (blur is costly).
  private fun strand(input: FrameInput, out: DrawList, centre: Float, amp: Float, half: Float, level: Float) {
    val p = input.params
    val turn = PI.toFloat() * 2f * half
    for (s in 0 until SEGMENTS) {
      for (k in 0..PER) {
        val u = (s * PER + k).toFloat() / (SEGMENTS * PER)
        input.point(u, centre + amp * sin(angle(u) + turn), e)
        xy[2 * k] = e.x
        xy[2 * k + 1] = e.y
      }
      val mid = (s + 0.5f) / SEGMENTS
      val depth = 0.5f + 0.5f * cos(angle(mid) + turn) // 1 = front
      val a = (0.35f + level).coerceAtMost(1f) * (0.3f + 0.7f * depth)
      val glow = if (depth > 0.5f) input.glowPx * (depth - 0.5f) else 0f
      out.polyline(xy, PER + 1, withAlpha(input.color(mid + half), a), p.thicknessPx * (0.35f + 0.5f * depth), glow, false)
    }
  }

  private companion object {
    const val SEGMENTS = 48
    const val PER = 6
    const val TWISTS = 12f
    const val RUNGS = 72
  }
}
