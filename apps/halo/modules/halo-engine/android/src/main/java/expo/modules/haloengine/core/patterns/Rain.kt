package expo.modules.haloengine.core.patterns

import expo.modules.haloengine.core.DrawList
import expo.modules.haloengine.core.EdgePath
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

/** Short streaks fall down the side edges (up when anticlockwise); louder music, heavier rain. */
class Rain : Pattern {
  override val id = "rain"
  override val family = Family.PARTICLES
  private val e = EdgePoint()
  private val box = EdgeBox()
  private val xy = FloatArray(4)
  private val rnd = Random(SEED)
  private val right = BooleanArray(CAP)
  private val depth = FloatArray(CAP)
  private val pos = FloatArray(CAP) // 0 at the start of the side, 1 at its end
  private val vel = FloatArray(CAP) // side lengths per second
  private val len = FloatArray(CAP)
  private val life = FloatArray(CAP)
  private val maxLife = FloatArray(CAP)
  private val hue = FloatArray(CAP)
  private var n = 0
  private var trickle = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    val dt = input.dt
    val level = input.spectrum.level
    box.update(input.path, e)
    if (input.spectrum.beat) repeat(8) { spawn(input) }
    trickle += level * dt * (40f + 120f * p.spread)
    while (trickle >= 1f) { spawn(input); trickle -= 1f }

    var i = 0
    while (i < n) {
      life[i] -= dt
      pos[i] += vel[i] * dt
      if (life[i] <= 0f || pos[i] >= 1f) { n--; move(n, i); continue }
      i++
    }

    val from = out.opCount
    val span = box.sideBottom - box.sideTop
    if (span <= 0f) { n = 0; return }
    val glow = input.glowPx * 0.2f
    val bands = input.spectrum.bands
    for (k in 0 until n) {
      val frac = life[k] / maxLife[k]
      val a = ((1f - frac) * 10f).coerceAtMost(1f) * (frac * 4f).coerceAtMost(1f)
      val x = if (right[k]) box.right - p.paddingPx - depth[k] else box.left + p.paddingPx + depth[k]
      val head = pos[k]
      val tail = (head - len[k] / span).coerceAtLeast(0f)
      xy[0] = x; xy[1] = sideY(tail, p.clockwise, span)
      xy[2] = x; xy[3] = sideY(head, p.clockwise, span)
      val b = band(bands, 1f - head) // bass lights the drops low on the side
      out.polyline(xy, 2, withAlpha(input.color(hue[k]), a * (0.35f + 0.65f * b)), p.thicknessPx * 0.22f, glow, false)
    }
    input.mirror(out, from, e)
  }

  private fun sideY(f: Float, down: Boolean, span: Float) = if (down) box.sideTop + f * span else box.sideBottom - f * span

  private fun spawn(input: FrameInput) {
    if (n == CAP) return
    val p = input.params
    val s = 0.6f + 1.6f * p.speed.coerceIn(0f, 1f)
    right[n] = !p.mirrored && rnd.nextBoolean() // mirrored: draw the left side, mirror() makes the right
    val r = rnd.nextFloat()
    depth[n] = input.path.length * (0.004f + 0.012f * p.spread) * r * r // most drops hug the edge
    pos[n] = 0.7f * rnd.nextFloat()
    vel[n] = (0.8f + 0.4f * rnd.nextFloat()) * s
    len[n] = p.thicknessPx * (1.5f + 2.5f * rnd.nextFloat()) * s
    maxLife[n] = 0.5f + 0.5f * rnd.nextFloat()
    life[n] = maxLife[n]
    hue[n] = rnd.nextFloat()
    n++
  }

  private fun move(src: Int, dst: Int) {
    right[dst] = right[src]; depth[dst] = depth[src]; pos[dst] = pos[src]; vel[dst] = vel[src]
    len[dst] = len[src]; life[dst] = life[src]; maxLife[dst] = maxLife[src]; hue[dst] = hue[src]
  }

  private companion object {
    const val CAP = 160
    const val SEED = 0x7A1EL
  }
}

/** The path's outer box and its straight runs, sampled once per path: the sides' y span and the bottom's x span. */
internal class EdgeBox {
  private var cached: EdgePath? = null
  var left = 0f; private set
  var right = 0f; private set
  var bottom = 0f; private set
  var sideTop = 0f; private set
  var sideBottom = 0f; private set
  var floorLeft = 0f; private set
  var floorRight = 0f; private set

  fun update(path: EdgePath, e: EdgePoint) {
    if (path === cached) return
    cached = path
    left = Float.MAX_VALUE; right = -Float.MAX_VALUE; bottom = -Float.MAX_VALUE
    for (i in 0 until SAMPLES) {
      path.at(i.toFloat() / SAMPLES, e)
      left = minOf(left, e.x); right = maxOf(right, e.x); bottom = maxOf(bottom, e.y)
    }
    sideTop = Float.MAX_VALUE; sideBottom = -Float.MAX_VALUE; floorLeft = Float.MAX_VALUE; floorRight = -Float.MAX_VALUE
    for (i in 0 until SAMPLES) {
      path.at(i.toFloat() / SAMPLES, e)
      if (e.x <= left + 0.5f) { sideTop = minOf(sideTop, e.y); sideBottom = maxOf(sideBottom, e.y) }
      if (e.y >= bottom - 0.5f) { floorLeft = minOf(floorLeft, e.x); floorRight = maxOf(floorRight, e.x) }
    }
  }

  private companion object {
    const val SAMPLES = 1024
  }
}
