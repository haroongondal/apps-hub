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
import java.util.Random
import kotlin.math.sin

/** Beats throw out bursts of embers (and steady music a trickle) that drift inward, sway and fade. */
class EmberDrift : Pattern {
  override val id = "ember-drift"
  override val family = Family.PARTICLES
  private val e = EdgePoint()
  private val rnd = Random(SEED)
  private val u = FloatArray(CAP)
  private val depth = FloatArray(CAP)
  private val vel = FloatArray(CAP)
  private val life = FloatArray(CAP)
  private val maxLife = FloatArray(CAP)
  private val size = FloatArray(CAP)
  private val hue = FloatArray(CAP)
  private val phase = FloatArray(CAP)
  private var n = 0
  private var trickle = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    val dt = input.dt
    val level = input.spectrum.level
    if (input.spectrum.beat) repeat(10 + (level * 30).toInt()) { spawn(input) }
    trickle += level * dt * 20f * (0.5f + p.spread)
    while (trickle >= 1f) { spawn(input); trickle -= 1f }

    var i = 0
    while (i < n) {
      life[i] -= dt
      if (life[i] <= 0f) { n--; move(n, i); continue }
      depth[i] += vel[i] * dt
      phase[i] += dt * 2f
      i++
    }

    val from = out.opCount
    val glow = input.glowPx
    for (k in 0 until n) {
      val frac = life[k] / maxLife[k]
      val a = ((1f - frac) * 10f).coerceAtMost(1f) * frac
      input.point(u[k] + 0.004f * sin(phase[k]), depth[k], e)
      out.dot(e.x, e.y, size[k] * (0.4f + 0.6f * frac), withAlpha(input.color(hue[k]), a), glow * (0.5f + 0.5f * frac))
    }
    input.mirror(out, from, e)
  }

  private fun spawn(input: FrameInput) {
    if (n == CAP) return
    val p = input.params
    val maxDepth = input.path.length * (0.01f + 0.04f * p.spread)
    u[n] = rnd.nextFloat()
    depth[n] = 0f
    maxLife[n] = (0.8f + 0.8f * rnd.nextFloat()) * (1.6f - p.speed.coerceIn(0f, 1f))
    life[n] = maxLife[n]
    vel[n] = maxDepth * (0.5f + 0.5f * rnd.nextFloat()) / maxLife[n]
    size[n] = p.thicknessPx * (0.3f + 0.5f * rnd.nextFloat())
    hue[n] = rnd.nextFloat()
    phase[n] = rnd.nextFloat() * 6.2832f
    n++
  }

  private fun move(src: Int, dst: Int) {
    u[dst] = u[src]; depth[dst] = depth[src]; vel[dst] = vel[src]; life[dst] = life[src]
    maxLife[dst] = maxLife[src]; size[dst] = size[src]; hue[dst] = hue[src]; phase[dst] = phase[src]
  }

  private companion object {
    const val CAP = 256
    const val SEED = 0x48A10L
  }
}
