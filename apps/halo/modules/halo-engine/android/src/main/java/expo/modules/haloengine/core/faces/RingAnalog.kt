package expo.modules.haloengine.core.faces

import expo.modules.haloengine.core.DrawList
import expo.modules.haloengine.core.Face
import expo.modules.haloengine.core.FaceInput
import expo.modules.haloengine.core.TEXT_ASCENT
import expo.modules.haloengine.core.accent
import expo.modules.haloengine.core.arc
import expo.modules.haloengine.core.blockTop
import expo.modules.haloengine.core.centreX
import expo.modules.haloengine.core.dotRing
import expo.modules.haloengine.core.fitSize
import expo.modules.haloengine.core.hand
import expo.modules.haloengine.core.infoLine
import expo.modules.haloengine.core.lineHeight
import expo.modules.haloengine.core.main
import expo.modules.haloengine.core.scale
import expo.modules.haloengine.core.withAlpha
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

class RingAnalog : Face {
  override val id = "ring-analog"
  override val name = "Ring"
  override val supportsSeconds = true
  private val ring = FloatArray(2 * 120)

  override fun draw(input: FaceInput, out: DrawList) = with(input) {
    val info = infoLine()
    var r = min(right - left, bottom - top) * 0.3f * scale
    var size = if (info.isEmpty()) 0f else fitSize(info, r * 0.16f)
    var gap = size * 0.8f
    var total = 2 * r + gap + lineHeight(size)
    if (total > bottom - top) {
      val k = (bottom - top) / total
      r *= k; size *= k; gap *= k; total *= k
    }
    val y0 = blockTop(total)
    val cx = centreX
    val cy = y0 + r
    val turn = 2 * PI.toFloat()
    arc(out, cx, cy, r, 0f, turn, withAlpha(main, 0.5f), max(2f, r * 0.012f), ring)
    dotRing(out, cx, cy, r * 0.88f, 60, 5, r * 0.022f, r * 0.009f, main)
    hand(out, cx, cy, turn * ((hour % 12) + minute / 60f) / 12f, r * 0.5f, main, r * 0.035f)
    hand(out, cx, cy, turn * minute / 60f, r * 0.78f, accent, r * 0.02f)
    out.dot(cx, cy, r * 0.04f, accent, 0f)
    if (options.seconds) {
      val a = turn * second / 60f
      out.dot(cx + r * 0.94f * sin(a), cy - r * 0.94f * cos(a), r * 0.03f, accent, 0f)
    }
    if (size > 0f) out.text(cx, cy + r + gap + TEXT_ASCENT * size, size, info, withAlpha(main, 0.75f), DrawList.REGULAR, DrawList.CENTRE)
  }
}
