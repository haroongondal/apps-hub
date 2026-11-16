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

/** Each beat strikes a spot on the rim: white-hot streaks fly inward and sideways, slow down and cool to colour. */
class Sparks : Pattern {
  override val id = "sparks"
  override val family = Family.PARTICLES
  private val e = EdgePoint()
  private val xy = FloatArray(4)
  private val rnd = Random(SEED)
  private val u = FloatArray(CAP)
  private val depth = FloatArray(CAP)
  private val vu = FloatArray(CAP)
  private val vd = FloatArray(CAP)
  private val life = FloatArray(CAP)
  private val maxLife = FloatArray(CAP)
  private val hue = FloatArray(CAP)
  private var n = 0
  private var crackle = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    val dt = input.dt
    val level = input.spectrum.level
    val reach = input.path.length * (0.01f + 0.03f * p.spread)
    val perU = (input.path.length * if (p.mirrored) 0.5f else 1f).coerceAtLeast(1f)
    if (input.spectrum.beat) {
      val site = rnd.nextFloat()
      repeat(10 + (level * 20).toInt()) { spawn(input, site, reach, perU) }
    }
    // Steady loud music crackles: single sparks anywhere, rising with the square of the level.
    crackle += level * level * dt * (10f + 30f * p.spread)
    while (crackle >= 1f) { spawn(input, rnd.nextFloat(), reach * 0.5f, perU); crackle -= 1f }

    val drag = exp(-3f * dt)
    var i = 0
    while (i < n) {
      life[i] -= dt
      if (life[i] <= 0f) { n--; move(n, i); continue }
      u[i] += vu[i] * dt
      depth[i] = (depth[i] + vd[i] * dt).coerceAtLeast(0f)
      vu[i] *= drag
      vd[i] *= drag
      i++
    }

    val from = out.opCount
    val glow = input.glowPx * 0.25f
    for (k in 0 until n) {
      val frac = life[k] / maxLife[k]
      input.point(u[k] - vu[k] * STREAK_S, (depth[k] - vd[k] * STREAK_S).coerceAtLeast(0f), e)
      xy[0] = e.x; xy[1] = e.y
      input.point(u[k], depth[k], e)
      xy[2] = e.x; xy[3] = e.y
      val c = lerpColor(input.color(hue[k]), WHITE, frac * frac)
      out.polyline(xy, 2, withAlpha(c, frac), p.thicknessPx * (0.15f + 0.25f * frac), glow * frac, false)
    }
    input.mirror(out, from, e)
  }

  private fun spawn(input: FrameInput, site: Float, reach: Float, perU: Float) {
    if (n == CAP) return
    val s = 0.6f + 0.8f * input.params.speed.coerceIn(0f, 1f)
    u[n] = site
    depth[n] = 0f
    // Drag e^-3t carries a spark v/3 px, so inward travel stays within `reach`.
    vd[n] = reach * (1.5f + 1.5f * rnd.nextFloat()) * s
    vu[n] = reach * (rnd.nextFloat() * 4f - 2f) * s / perU
    maxLife[n] = (0.35f + 0.45f * rnd.nextFloat()) * (1.2f - 0.5f * input.params.speed.coerceIn(0f, 1f))
    life[n] = maxLife[n]
    hue[n] = site + 0.3f * rnd.nextFloat()
    n++
  }

  private fun move(src: Int, dst: Int) {
    u[dst] = u[src]; depth[dst] = depth[src]; vu[dst] = vu[src]; vd[dst] = vd[src]
    life[dst] = life[src]; maxLife[dst] = maxLife[src]; hue[dst] = hue[src]
  }

  private companion object {
    const val CAP = 120
    const val SEED = 0x5BA4CL
    const val STREAK_S = 0.05f // tail length in seconds of travel
    const val WHITE = -1 // 0xFFFFFFFF
  }
}
