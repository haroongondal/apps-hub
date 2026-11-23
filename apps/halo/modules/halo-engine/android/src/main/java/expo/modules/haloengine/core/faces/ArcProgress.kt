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

/** A thin arc that fills clockwise from 12 o'clock as the day goes (midnight to midnight), the time and "NN% of day" in the middle. No seconds: the arc moves once a minute. */
class ArcProgress : Face {
  override val id = "arc-progress"
  override val name = "Day arc"
  override val supportsSeconds = false
  private val track = FloatArray(2 * 120)
  private val progress = FloatArray(2 * 180)

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
    val radius = r * 0.94f
    val fraction = dayFraction(hour, minute)
    val sweep = 2 * PI.toFloat() * fraction
    arc(out, cx, cy, radius, 0f, 2 * PI.toFloat(), withAlpha(main, 0.25f), max(1.5f, r * 0.008f), track)
    if (sweep > 0.02f) {
      arc(out, cx, cy, radius, 0f, sweep, withAlpha(accent, 0.35f), max(4f, r * 0.04f), progress)
      arc(out, cx, cy, radius, 0f, sweep, accent, max(2f, r * 0.016f), progress)
    }
    out.dot(cx + radius * sin(sweep), cy - radius * cos(sweep), r * 0.035f, accent, 0f)
    val time = timeText(hour, minute, options.h24)
    val timeSize = min(r * 0.42f, r * 1.3f / (time.length * TEXT_ADVANCE))
    val pct = "${(fraction * 100).toInt()}% of day"
    val pctSize = min(timeSize * 0.32f, r * 1.3f / (pct.length * TEXT_ADVANCE))
    val baseline = cy + 0.1f * timeSize
    out.text(cx, baseline, timeSize, time, main, DrawList.BOLD, DrawList.CENTRE)
    out.text(cx, baseline + 0.2f * timeSize + TEXT_ASCENT * pctSize, pctSize, pct, withAlpha(main, 0.75f), DrawList.REGULAR, DrawList.CENTRE)
    if (size > 0f) out.text(cx, cy + r + gap + TEXT_ASCENT * size, size, info, withAlpha(main, 0.75f), DrawList.REGULAR, DrawList.CENTRE)
  }

  companion object {
    /** Share of the day gone, 0 at 00:00 and 1439/1440 at 23:59. */
    fun dayFraction(hour: Int, minute: Int): Float = (hour * 60 + minute) / 1440f
  }
}
