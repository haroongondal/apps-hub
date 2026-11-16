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
import kotlin.math.sin

/** Pale flakes drift out onto the rim from a little way in, swaying as they fall, then rest there glinting and melt. */
class RimSnow : Pattern {
  override val id = "rim-snow"
  override val family = Family.PARTICLES
  private val e = EdgePoint()
  private val rnd = Random(SEED)
  private val u = FloatArray(CAP)
  private val depth = FloatArray(CAP)
  private val fall = FloatArray(CAP)
  private val life = FloatArray(CAP)
  private val maxLife = FloatArray(CAP)
  private val size = FloatArray(CAP)
  private val phase = FloatArray(CAP)
  private var n = 0
  private var trickle = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    val dt = input.dt
    val level = input.spectrum.level
    val maxDepth = input.path.length * (0.008f + 0.03f * p.spread)
    if (input.spectrum.beat) repeat(4) { spawn(input, maxDepth) }
    trickle += level * dt * (30f + 90f * p.spread)
    while (trickle >= 1f) { spawn(input, maxDepth); trickle -= 1f }

    var i = 0
    while (i < n) {
      life[i] -= dt
      if (life[i] <= 0f) { n--; move(n, i); continue }
      depth[i] = (depth[i] - fall[i] * dt).coerceAtLeast(0f)
      phase[i] += dt * (1f + 2f * p.speed)
      i++
    }

    val from = out.opCount
    val glow = input.glowPx * 0.25f
    val perU = (input.path.length * if (p.mirrored) 0.5f else 1f).coerceAtLeast(1f)
    val swayU = p.thicknessPx * 1.5f / perU
    for (k in 0 until n) {
      val frac = life[k] / maxLife[k]
      var a = ((1f - frac) * 8f).coerceAtMost(1f) * (frac * 3f).coerceAtMost(1f)
      if (depth[k] == 0f) a *= 0.7f + 0.3f * sin(phase[k] * 3f) // resting flakes glint
      // Sway shrinks with height so a flake lands where it is, without a jump.
      val sway = swayU * sin(phase[k]) * (depth[k] / maxDepth.coerceAtLeast(1f)).coerceAtMost(1f)
      input.point(u[k] + sway, depth[k], e)
      val c = lerpColor(input.color(u[k] * 0.5f), WHITE, 0.6f)
      out.dot(e.x, e.y, size[k], withAlpha(c, a), glow)
    }
    input.mirror(out, from, e)
  }

  private fun spawn(input: FrameInput, maxDepth: Float) {
    if (n == CAP) return
    val p = input.params
    u[n] = rnd.nextFloat()
    depth[n] = maxDepth * (0.4f + 0.6f * rnd.nextFloat())
    // At speed 0 a flake lives at most 2.8 s, so everything melts within the silence window.
    maxLife[n] = (1.4f + 1.0f * rnd.nextFloat()) * (1.15f - 0.6f * p.speed.coerceIn(0f, 1f))
    life[n] = maxLife[n]
    fall[n] = depth[n] / (0.55f * maxLife[n]) // falls for about half its life, rests for the rest
    size[n] = p.thicknessPx * (0.15f + 0.2f * rnd.nextFloat())
    phase[n] = rnd.nextFloat() * 6.2832f
    n++
  }

  private fun move(src: Int, dst: Int) {
    u[dst] = u[src]; depth[dst] = depth[src]; fall[dst] = fall[src]; life[dst] = life[src]
    maxLife[dst] = maxLife[src]; size[dst] = size[src]; phase[dst] = phase[src]
  }

  private companion object {
    const val CAP = 140
    const val SEED = 0x5A0F1L
    const val WHITE = -1 // 0xFFFFFFFF
  }
}
