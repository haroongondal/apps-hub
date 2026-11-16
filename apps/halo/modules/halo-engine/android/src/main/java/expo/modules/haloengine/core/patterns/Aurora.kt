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
import kotlin.math.PI
import kotlin.math.sin

/** Soft layered curtains drift along the top and bottom edges, fading out down the sides, streaked where bands are loud. */
class Aurora : Pattern {
  override val id = "aurora"
  override val family = Family.WAVES
  private val e = EdgePoint()
  private val xy = FloatArray(2 * (PER + 1))
  private val drift = FloatArray(LAYERS)
  private var hue = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    val dt = input.dt
    for (l in 0 until LAYERS) drift[l] = (drift[l] + dt * (0.01f + 0.08f * p.speed) * (1f + 0.6f * l)) % 1f
    hue = (hue + dt * (0.005f + 0.04f * p.speed)) % 1f
    val level = input.spectrum.level
    if (level < 0.01f) return
    val from = out.opCount
    val th = p.thicknessPx
    val reach = th * (1f + 3f * p.spread)
    val glow = input.glowPx
    val energy = (0.3f + 1.4f * level).coerceAtMost(1f)
    for (l in 0 until LAYERS) {
      val width = th * (3.2f - 0.8f * l)
      for (s in 0 until SEGMENTS) {
        val mid = (s + 0.5f) / SEGMENTS
        val w = edgeWeight(input, mid)
        if (w < 0.05f) continue
        for (k in 0..PER) {
          val u = (s * PER + k).toFloat() / (SEGMENTS * PER)
          input.point(u, depth(l, u, reach, width), e)
          xy[2 * k] = e.x
          xy[2 * k + 1] = e.y
        }
        val shimmer = 0.6f + 0.4f * sin(2f * PI.toFloat() * (5f * mid + 2f * drift[l]))
        val a = (0.16f + 0.1f * l) * energy * w * shimmer
        out.polyline(xy, PER + 1, withAlpha(input.color(hue + 0.3f * l + 0.25f * mid), a), width,
          if (l == 0) glow * 1.5f else 0f, false)
      }
    }
    val bands = input.spectrum.bands
    for (r in 0 until RAYS) {
      val u = (r + 0.5f) / RAYS
      val w = edgeWeight(input, u)
      val v = band(bands, (u * 3f) % 1f)
      if (w < 0.2f || v < 0.1f) continue
      val d = depth(LAYERS - 1, u, reach, th)
      input.point(u, d, e)
      xy[0] = e.x; xy[1] = e.y
      input.point(u, d + reach * v, e)
      xy[2] = e.x; xy[3] = e.y
      out.polyline(xy, 2, withAlpha(input.color(hue + u), 0.35f * v * w * energy), th * 0.3f, 0f, false)
    }
    input.mirror(out, from, e)
  }

  // ny is ±1 on the top and bottom edges and 0 on the sides, so this keeps the light to the long horizontal runs.
  private fun edgeWeight(input: FrameInput, u: Float): Float {
    input.point(u, 0f, e)
    return e.ny * e.ny
  }

  private fun depth(l: Int, u: Float, reach: Float, width: Float): Float {
    val wave = 0.5f + 0.25f * sin(2f * PI.toFloat() * (2f * u + drift[l])) + 0.25f * sin(2f * PI.toFloat() * (5f * u - drift[l]) + l)
    return width * 0.5f + reach * (0.15f * l + 0.6f * wave)
  }

  private companion object {
    const val LAYERS = 3
    const val SEGMENTS = 40
    const val PER = 6
    const val RAYS = 96
  }
}
