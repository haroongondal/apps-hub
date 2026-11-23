package expo.modules.haloengine.core.faces

import expo.modules.haloengine.core.DrawList
import expo.modules.haloengine.core.Face
import expo.modules.haloengine.core.FaceInput
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
import java.util.Calendar
import kotlin.math.PI
import kotlin.math.min

private val DAYS = listOf("mon", "tue", "wed", "thu", "fri", "sat", "sun")
private const val LETTERS = "MTWTFSS"

/** 0 = Monday .. 6 = Sunday. Reads the English weekday abbreviation out of dateText ("Wed 18 Nov"); shortcut: other locales fall back to the system calendar, which is the same day. */
fun weekdayIndex(dateText: String): Int {
  for (word in dateText.split(Regex("[^A-Za-z]+"))) {
    val i = DAYS.indexOf(word.take(3).lowercase())
    if (i >= 0 && word.length >= 3) return i
  }
  return (Calendar.getInstance().get(Calendar.DAY_OF_WEEK) + 5) % 7
}

/** The time with a Monday-to-Sunday strip below it; today's letter is bold in the accent colour inside a thin ring. Seconds are ignored. */
class CalendarStrip : Face {
  override val id = "calendar-strip"
  override val name = "Calendar strip"
  override val supportsSeconds = false
  private val ring = FloatArray(2 * 40)

  override fun draw(input: FaceInput, out: DrawList) = with(input) {
    val time = timeText(hour, minute, options.h24)
    var t = fitSize(time, min(right - left, bottom - top) * 0.26f * scale)
    var d = min(t * 0.45f, (right - left) / 7f)
    var s = d / 1.6f
    val info = infoLine()
    var i = if (info.isEmpty()) 0f else fitSize(info, t * 0.16f)
    var total = lineHeight(t) + 0.25f * t + 1.6f * s + if (i > 0f) 0.25f * t + lineHeight(i) else 0f
    val k = min(1f, (bottom - top) / total)
    t *= k; d *= k; s *= k; i *= k; total *= k
    val y0 = blockTop(total)
    out.text(centreX, y0 + TEXT_ASCENT * t, t, time, main, DrawList.BOLD, DrawList.CENTRE)
    val rowTop = y0 + lineHeight(t) + 0.25f * t
    val today = weekdayIndex(dateText)
    for (n in 0 until 7) {
      val x = centreX + (n - 3) * d
      val y = rowTop + 0.8f * s // row centre
      val baseline = y + 0.34f * s // cap height is 0.68 em, so this centres the capital on y
      if (n == today) {
        out.text(x, baseline, s, LETTERS[n].toString(), accent, DrawList.BOLD, DrawList.CENTRE)
        arc(out, x, y, 0.75f * s, 0f, 2 * PI.toFloat(), accent, maxOf(2f, s * 0.05f), ring)
      } else out.text(x, baseline, s, LETTERS[n].toString(), withAlpha(main, 0.5f), DrawList.REGULAR, DrawList.CENTRE)
    }
    if (i > 0f) out.text(centreX, rowTop + 1.6f * s + 0.25f * t + TEXT_ASCENT * i, i, info, withAlpha(main, 0.75f), DrawList.REGULAR, DrawList.CENTRE)
  }
}
