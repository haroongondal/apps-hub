package expo.modules.haloengine.core.patterns

import expo.modules.haloengine.core.DrawList
import expo.modules.haloengine.core.EdgePath
import expo.modules.haloengine.core.EdgePoint
import expo.modules.haloengine.core.Family
import expo.modules.haloengine.core.FrameInput
import expo.modules.haloengine.core.Pattern
import expo.modules.haloengine.core.color
import expo.modules.haloengine.core.dt
import expo.modules.haloengine.core.glowPx
import expo.modules.haloengine.core.mirror
import expo.modules.haloengine.core.pointAt
import expo.modules.haloengine.core.withAlpha

/** Each corner blooms with its own slice of the spectrum, bass first in travel order, in three soft layers. */
class CornerBloom : Pattern {
  override val id = "corner-bloom"
  override val family = Family.LIGHTS
  private val e = EdgePoint()
  private val xy = FloatArray(2 * PTS)
  private val cornerT = FloatArray(4) // TR, BR, BL, TL
  private var cached: EdgePath? = null
  private var drift = 0f

  override fun draw(input: FrameInput, out: DrawList) {
    val p = input.params
    if (input.path !== cached) findCorners(input.path)
    drift = (drift + input.dt * (0.01f + 0.12f * p.speed)) % 1f
    val bands = input.spectrum.bands
    val n = if (p.mirrored) 2 else 4
    val from = out.opCount
    for (c in 0 until n) {
      var sum = 0f
      val lo = c * bands.size / n
      val hi = (c + 1) * bands.size / n
      for (b in lo until hi) sum += bands[b]
      val v = if (hi > lo) (sum / (hi - lo) * 1.6f).coerceAtMost(1f) else 0f
      if (v < 0.02f) continue
      val corner = if (p.clockwise) c else 3 - c
      val col = input.color(corner / 4f + drift)
      val span = (0.02f + 0.08f * p.spread) * (0.4f + 0.6f * v)
      val th = p.thicknessPx
      val glow = input.glowPx
      layer(input, out, cornerT[corner], span, th * (1f + 3f * v) * 1.6f, withAlpha(col, 0.25f * v), glow * 2f)
      layer(input, out, cornerT[corner], span * 0.75f, th * (1f + 2f * v), withAlpha(col, 0.5f * v), glow)
      layer(input, out, cornerT[corner], span * 0.5f, th * 0.6f, withAlpha(col, v), glow * 0.5f)
    }
    input.mirror(out, from, e)
  }

  private fun layer(input: FrameInput, out: DrawList, tc: Float, span: Float, width: Float, color: Int, glow: Float) {
    for (k in 0 until PTS) {
      input.pointAt(tc + span * (2f * k / (PTS - 1) - 1f), 0f, e)
      xy[2 * k] = e.x
      xy[2 * k + 1] = e.y
    }
    out.polyline(xy, PTS, color, width, glow, false)
  }

  private fun findCorners(path: EdgePath) {
    cached = path
    val best = FloatArray(4) { Float.NEGATIVE_INFINITY }
    for (i in 0 until 512) {
      val t = i / 512f
      path.at(t, e)
      val score = floatArrayOf(e.x - e.y, e.x + e.y, -e.x + e.y, -e.x - e.y)
      for (c in 0 until 4) if (score[c] > best[c]) { best[c] = score[c]; cornerT[c] = t }
    }
  }

  private companion object {
    const val PTS = 16
  }
}
