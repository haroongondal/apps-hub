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
import kotlin.math.abs
import kotlin.math.exp

/** A heart-monitor trace runs round the edge: each beat (or every 1.2 s of beatless music) sends a blip along it. */
class PulseWave : Pattern {
  override val id = "pulse-wave"
  override val family = Family.WAVES
  private val e = EdgePoint()
  private val xy = FloatArray(2 * (PER + 1))
  private val pos = FloatArray(CAP)
  private val amp = FloatArray(CAP)
  private var n = 0
  private var sinceBlip = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    val dt = input.dt
    val level = input.spectrum.level
    val travel = 0.06f + 0.3f * p.speed
    var i = 0
    while (i < n) {
      pos[i] += travel * dt
      amp[i] *= exp(-1.8f * dt)
      if (amp[i] < 0.03f || pos[i] > 1f) { n--; pos[i] = pos[n]; amp[i] = amp[n]; continue }
      i++
    }
    sinceBlip += dt
    if (level > 0.05f && (input.spectrum.beat || sinceBlip > 1.2f) && n < CAP) {
      pos[n] = 0f
      amp[n] = (0.4f + 1.2f * level).coerceAtMost(1f)
      n++
      sinceBlip = 0f
    }
    if (level < 0.01f && n == 0) return

    val th = p.thicknessPx
    val maxA = input.path.length * (0.006f + 0.02f * p.spread)
    val base = th * 0.5f + DIP * maxA
    val width = 0.02f + 0.04f * p.spread
    val bands = input.spectrum.bands
    val from = out.opCount
    for (s in 0 until SEGMENTS) {
      var near = 0f
      for (k in 0..PER) {
        val u = (s * PER + k).toFloat() / (SEGMENTS * PER)
        var off = band(bands, 1f - u) * th * 0.4f
        for (j in 0 until n) {
          val x = (u - pos[j]) / width
          if (abs(x) < 1f) { off += amp[j] * maxA * shape(x); near = maxOf(near, amp[j]) }
        }
        input.point(u, base + off, e)
        xy[2 * k] = e.x
        xy[2 * k + 1] = e.y
      }
      val a = (0.25f + 0.5f * level + 0.5f * near).coerceAtMost(1f)
      out.polyline(xy, PER + 1, withAlpha(input.color((s + 0.5f) / SEGMENTS), a), th * (0.35f + 0.25f * near),
        input.glowPx * near, false)
    }
    for (j in 0 until n) {
      input.point(pos[j] - 0.15f * width, base + amp[j] * maxA, e)
      out.dot(e.x, e.y, th * 0.5f * (0.6f + amp[j]), withAlpha(input.color(pos[j]), amp[j]), input.glowPx * amp[j])
    }
    input.mirror(out, from, e)
  }

  // One heartbeat on x in -1..1: a small bump, a tall spike, a dip below the line, a slow bump; 0 at both ends.
  private fun shape(x: Float): Float {
    fun peak(c: Float, w: Float, h: Float): Float {
      val d = (x - c) / w
      return if (abs(d) < 1f) h * (1f - d * d) * (1f - d * d) else 0f
    }
    return peak(-0.7f, 0.2f, 0.15f) + peak(-0.15f, 0.15f, 1f) + peak(0.1f, 0.15f, -DIP) + peak(0.6f, 0.3f, 0.25f)
  }

  private companion object {
    const val SEGMENTS = 32
    const val PER = 20
    const val CAP = 8
    const val DIP = 0.35f
  }
}
