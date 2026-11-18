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
import java.util.Random
import kotlin.math.exp
import kotlin.math.sin

/** A small swarm of soft lights wanders just inside the rim; more come out as it gets louder, each blinking to its own band. */
class Fireflies : Pattern {
  override val id = "fireflies"
  override val family = Family.PARTICLES
  private val e = EdgePoint()
  private val rnd = Random(SEED)
  private val u0 = FloatArray(N) { rnd.nextFloat() }
  private val deep = FloatArray(N) { 0.3f + 0.7f * rnd.nextFloat() }
  private val phase = FloatArray(N) { rnd.nextFloat() * 6.2832f }
  private val blinkRate = FloatArray(N) { 1.5f + 2.5f * rnd.nextFloat() }
  private val wander = FloatArray(N) { 0.4f + 0.8f * rnd.nextFloat() }
  private val bandAt = FloatArray(N) { rnd.nextFloat() }
  private var clock = 0f
  private var energy = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    val dt = input.dt
    energy = maxOf(input.spectrum.level, energy * exp(-1.5f * dt))
    clock += dt * (0.3f + 1.4f * p.speed)
    if (energy < 0.02f) return
    val from = out.opCount
    val maxDepth = input.path.length * (0.006f + 0.03f * p.spread)
    val glow = input.glowPx
    val bands = input.spectrum.bands
    for (k in 0 until N) {
      // Louder music brings more of the swarm out, one by one, each fading in.
      val vis = (energy * 1.5f * N - k).coerceIn(0f, 1f)
      if (vis <= 0f) break
      val ph = phase[k]
      val w = wander[k]
      val uu = u0[k] + 0.004f * clock + 0.02f * sin(clock * w + ph) + 0.008f * sin(clock * w * 2.3f + 1.7f * ph)
      val d = maxDepth * deep[k] * (0.55f + 0.45f * sin(clock * w * 0.8f + 2f * ph))
      val s = 0.5f + 0.5f * sin(clock * blinkRate[k] + ph)
      val blink = s * s * s // mostly dim, with short bright flashes
      val b = band(bands, bandAt[k])
      input.point(uu, d, e)
      val a = vis * (0.15f + 0.85f * blink) * (0.35f + 0.65f * b)
      out.dot(e.x, e.y, p.thicknessPx * (0.3f + 0.3f * b), withAlpha(input.color(bandAt[k]), a), glow * (0.5f + 0.7f * blink))
    }
    input.mirror(out, from, e)
  }

  private companion object {
    const val N = 40
    const val SEED = 0xF1EF1L
  }
}
