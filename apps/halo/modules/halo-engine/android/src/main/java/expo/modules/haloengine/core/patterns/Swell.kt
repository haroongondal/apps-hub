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

/** Long, slow swells roll round the edge like sea water: a deep translucent body with a bright crest; bass lifts it. */
class Swell : Pattern {
  override val id = "swell"
  override val family = Family.WAVES
  private val e = EdgePoint()
  private val xy = FloatArray(2 * (PER + 1))
  private val height = FloatArray(SEGMENTS * PER + 1)
  private var phase = 0f
  private var bass = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    val dt = input.dt
    phase = (phase + dt * (0.03f + 0.3f * p.speed)) % 1f
    val level = input.spectrum.level
    if (level < 0.01f) { bass = 0f; return }
    val bands = input.spectrum.bands
    var low = 0f
    for (b in 0 until minOf(6, bands.size)) low += bands[b] / 6f
    bass += (low - bass) * (1f - exp(-8f * dt)) // eases the lift so the water does not jitter

    val maxH = input.path.length * (0.006f + 0.018f * p.spread) * (0.3f + 0.7f * (level + bass).coerceAtMost(1f))
    for (i in height.indices) {
      val u = i.toFloat() / (SEGMENTS * PER)
      val a = 0.5f + 0.5f * sin(2f * PI.toFloat() * (3f * u - phase))
      val b = 0.5f + 0.5f * sin(2f * PI.toFloat() * (5f * u + 0.7f * phase) + 1.3f)
      height[i] = maxH * (0.2f + 0.6f * a * a + 0.2f * b)
    }
    val from = out.opCount
    val th = p.thicknessPx
    val alpha = (0.3f + level).coerceAtMost(1f)
    // The body is stacked layers at fractions of the local height, deeper ones fainter, none blurred.
    layer(input, out, 0.25f, th * 2.2f, 0.18f * alpha, 0f, 0f)
    layer(input, out, 0.55f, th * 1.6f, 0.26f * alpha, 0f, 0.1f)
    layer(input, out, 0.8f, th * 1.1f, 0.4f * alpha, 0f, 0.2f)
    layer(input, out, 1f, th * 0.6f, alpha, input.glowPx * 0.8f, 0.3f)
    input.mirror(out, from, e)
  }

  private fun layer(input: FrameInput, out: DrawList, frac: Float, width: Float, alpha: Float, glow: Float, hue: Float) {
    val pad = width * 0.5f
    for (s in 0 until SEGMENTS) {
      for (k in 0..PER) {
        val i = s * PER + k
        input.point(i.toFloat() / (SEGMENTS * PER), pad + height[i] * frac, e)
        xy[2 * k] = e.x
        xy[2 * k + 1] = e.y
      }
      out.polyline(xy, PER + 1, withAlpha(input.color(hue + (s + 0.5f) / SEGMENTS), alpha), width, glow, false)
    }
  }

  private companion object {
    const val SEGMENTS = 24
    const val PER = 10
  }
}
