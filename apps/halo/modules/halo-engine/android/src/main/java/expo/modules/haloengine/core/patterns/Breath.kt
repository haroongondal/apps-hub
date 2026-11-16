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
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

/** The whole rim breathes: a soft haze swells inward with the slowly smoothed level, its tint drifting over time. */
class Breath : Pattern {
  override val id = "breath"
  override val family = Family.LIGHTS
  private val e = EdgePoint()
  private val xy = FloatArray(2 * (PTS + 1))
  private var env = 0f
  private var phase = 0f
  private var hue = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    val dt = input.dt
    val target = (input.spectrum.level * 1.8f).coerceAtMost(1f)
    // Slow in, slow out: no beat flashes, just the level's envelope.
    val rate = if (target > env) 1.5f + 4f * p.speed else 2f + 2f * p.speed
    env += (target - env) * (1f - exp(-rate * dt))
    phase = (phase + dt * (0.12f + 0.5f * p.speed)) % 1f
    hue = (hue + dt * (0.01f + 0.05f * p.speed)) % 1f
    if (env < 0.02f) return
    val a = env * (0.82f + 0.18f * sin(2f * PI.toFloat() * phase))
    val th = p.thicknessPx
    val reach = th * (1f + 6f * p.spread) * a + th
    val from = out.opCount
    ring(input, out, reach * 0.5f, reach, withAlpha(input.color(hue + 0.5f), 0.22f * a), input.glowPx * 2f)
    ring(input, out, reach * 0.2f, th * (0.6f + 1.4f * a), withAlpha(input.color(hue + 0.25f), 0.5f * a), input.glowPx)
    ring(input, out, 0f, th * 0.35f, withAlpha(input.color(hue), (1.2f * a).coerceAtMost(1f)), input.glowPx * 0.3f)
    input.mirror(out, from, e)
  }

  private fun ring(input: FrameInput, out: DrawList, inward: Float, width: Float, color: Int, glow: Float) {
    val closed = !input.params.mirrored
    val n = if (closed) PTS else PTS + 1
    for (k in 0 until n) {
      input.point(k.toFloat() / PTS, inward, e)
      xy[2 * k] = e.x
      xy[2 * k + 1] = e.y
    }
    out.polyline(xy, n, color, width, glow, closed)
  }

  private companion object {
    const val PTS = 192
  }
}
