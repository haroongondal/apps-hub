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
import expo.modules.haloengine.core.withAlpha
import java.util.Random
import kotlin.math.cos
import kotlin.math.sin

/** Hollow bubbles, sized by the bass, rise wobbling from the bottom edge, drift with the current and pop. */
class Bubbles : Pattern {
  override val id = "bubbles"
  override val family = Family.PARTICLES
  private val e = EdgePoint()
  private val box = EdgeBox()
  private val ring = FloatArray(2 * RING)
  private val rnd = Random(SEED)
  private val x = FloatArray(CAP)
  private val rise = FloatArray(CAP)
  private val vRise = FloatArray(CAP)
  private val radius = FloatArray(CAP)
  private val life = FloatArray(CAP)
  private val maxLife = FloatArray(CAP)
  private val phase = FloatArray(CAP)
  private val hue = FloatArray(CAP)
  private var n = 0
  private var trickle = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    val dt = input.dt
    val level = input.spectrum.level
    box.update(input.path, e)
    val lo = box.floorLeft
    val hi = if (p.mirrored) (box.floorLeft + box.floorRight) / 2 else box.floorRight
    val bass = band(input.spectrum.bands, 0.1f)
    if (input.spectrum.beat) repeat(3) { spawn(input, lo, hi, bass) }
    trickle += level * dt * (4f + 10f * p.spread)
    while (trickle >= 1f) { spawn(input, lo, hi, bass); trickle -= 1f }

    val current = (if (p.clockwise) 1f else -1f) * p.thicknessPx * (1f + 3f * p.speed)
    var i = 0
    while (i < n) {
      life[i] -= dt
      if (life[i] <= 0f) { n--; move(n, i); continue }
      rise[i] += vRise[i] * dt
      x[i] += current * dt
      phase[i] += dt * (3f + 2f * p.speed)
      i++
    }

    val from = out.opCount
    val glow = input.glowPx * 0.2f
    val width = (p.thicknessPx * 0.15f).coerceAtLeast(1f)
    for (k in 0 until n) {
      val frac = life[k] / maxLife[k]
      var r = radius[k]
      var a = ((1f - frac) * 8f).coerceAtMost(1f)
      if (frac < POP) { r *= 1f + 0.8f * (1f - frac / POP); a *= frac / POP } // pop: swell and vanish
      // Keep the whole ring over the straight bottom, wobble and pop included.
      val cx = (x[k] + 0.6f * radius[k] * sin(phase[k])).coerceIn(lo + r, maxOf(lo + r, hi - r))
      val cy = box.bottom - p.paddingPx - r - rise[k]
      for (j in 0 until RING) {
        val ang = j * 6.2832f / RING
        ring[2 * j] = cx + r * cos(ang)
        ring[2 * j + 1] = cy + r * sin(ang)
      }
      val c = input.color(hue[k])
      out.polyline(ring, RING, withAlpha(c, a * 0.8f), width, glow, true)
      out.dot(cx - 0.35f * r, cy - 0.35f * r, r * 0.18f, withAlpha(-1, a * 0.7f), 0f) // highlight
    }
    input.mirror(out, from, e)
  }

  private fun spawn(input: FrameInput, lo: Float, hi: Float, bass: Float) {
    if (n == CAP) return
    val p = input.params
    // Cap the size by the floor width so a popped bubble always fits over the straight bottom.
    radius[n] = (p.thicknessPx * (0.4f + 0.8f * rnd.nextFloat()) * (0.7f + 0.6f * bass)).coerceAtMost((hi - lo) * 0.1f)
    x[n] = lo + (hi - lo) * rnd.nextFloat()
    rise[n] = 0f
    // At speed 0 a bubble lives at most 2.86 s, so all are gone within the silence window.
    maxLife[n] = (1.2f + 1.0f * rnd.nextFloat()) * (1.3f - 0.6f * p.speed.coerceIn(0f, 1f))
    life[n] = maxLife[n]
    vRise[n] = input.path.length * (0.015f + 0.05f * p.spread) * (0.5f + 0.5f * rnd.nextFloat()) / maxLife[n]
    phase[n] = rnd.nextFloat() * 6.2832f
    hue[n] = rnd.nextFloat()
    n++
  }

  private fun move(src: Int, dst: Int) {
    x[dst] = x[src]; rise[dst] = rise[src]; vRise[dst] = vRise[src]; radius[dst] = radius[src]
    life[dst] = life[src]; maxLife[dst] = maxLife[src]; phase[dst] = phase[src]; hue[dst] = hue[src]
  }

  private companion object {
    const val CAP = 48
    const val RING = 12
    const val POP = 0.12f
    const val SEED = 0xB0BB1L
  }
}
