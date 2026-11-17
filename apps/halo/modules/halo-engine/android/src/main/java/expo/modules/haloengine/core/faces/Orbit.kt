package expo.modules.haloengine.core.faces

import expo.modules.haloengine.core.DrawList
import expo.modules.haloengine.core.Face
import expo.modules.haloengine.core.FaceInput
import expo.modules.haloengine.core.TEXT_ADVANCE
import expo.modules.haloengine.core.TEXT_ASCENT
import expo.modules.haloengine.core.accent
import expo.modules.haloengine.core.arc
import expo.modules.haloengine.core.blockTop
import expo.modules.haloengine.core.centreX
import expo.modules.haloengine.core.fitSize
import expo.modules.haloengine.core.infoLine
import expo.modules.haloengine.core.lineHeight
import expo.modules.haloengine.core.main
import expo.modules.haloengine.core.scale
import expo.modules.haloengine.core.timeText
import expo.modules.haloengine.core.withAlpha
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * Two thin rings with one dot each: the outer dot is the minute (with a faint trail behind it), the inner dot the hour on a 12 h dial
 * (so h24 only changes the digits in the middle). Seconds, when on, are a speck riding the outer ring.
 */
class Orbit : Face {
  override val id = "orbit"
  override val name = "Orbit"
  override val supportsSeconds = true
  private val trail = FloatArray(2 * 90)
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
    val cx = centreX
    val cy = blockTop(total) + r
    val turn = 2 * PI.toFloat()
    val outer = r * 0.94f
    val inner = r * 0.72f
    val stroke = max(1.5f, r * 0.008f)
    arc(out, cx, cy, outer, 0f, turn, withAlpha(main, 0.4f), stroke, ring)
    arc(out, cx, cy, inner, 0f, turn, withAlpha(accent, 0.4f), stroke, ring)
    val minuteAt = turn * minute / 60f
    if (minuteAt > 0.02f) arc(out, cx, cy, outer, 0f, minuteAt, withAlpha(main, 0.25f), stroke * 2f, trail)
    out.dot(cx + outer * sin(minuteAt), cy - outer * cos(minuteAt), r * 0.045f, main, 0f)
    val hourAt = turn * ((hour % 12) + minute / 60f) / 12f
    out.dot(cx + inner * sin(hourAt), cy - inner * cos(hourAt), r * 0.05f, accent, 0f)
    if (options.seconds) {
      val a = turn * second / 60f
      out.dot(cx + outer * sin(a), cy - outer * cos(a), r * 0.02f, accent, 0f)
    }
    val time = timeText(hour, minute, options.h24)
    val timeSize = min(r * 0.4f, r * 1.1f / (time.length * TEXT_ADVANCE))
    out.text(cx, cy + 0.34f * timeSize, timeSize, time, main, DrawList.BOLD, DrawList.CENTRE)
    if (size > 0f) out.text(cx, cy + r + gap + TEXT_ASCENT * size, size, info, withAlpha(main, 0.75f), DrawList.REGULAR, DrawList.CENTRE)
  }
}
