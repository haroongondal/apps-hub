package expo.modules.haloengine.core.faces

import expo.modules.haloengine.core.DrawList
import expo.modules.haloengine.core.Face
import expo.modules.haloengine.core.FaceInput
import expo.modules.haloengine.core.TEXT_ASCENT
import expo.modules.haloengine.core.accent
import expo.modules.haloengine.core.blockTop
import expo.modules.haloengine.core.centreX
import expo.modules.haloengine.core.fitSize
import expo.modules.haloengine.core.hourText
import expo.modules.haloengine.core.infoLine
import expo.modules.haloengine.core.lineHeight
import expo.modules.haloengine.core.main
import expo.modules.haloengine.core.scale
import expo.modules.haloengine.core.two
import expo.modules.haloengine.core.withAlpha
import kotlin.math.max
import kotlin.math.min

/** One digit per row, top to bottom: the hour digits in the main colour, a hairline, the minute digits in the accent colour. The text op cannot rotate, so this is a column, not turned text. */
class Vertical : Face {
  override val id = "vertical"
  override val name = "Vertical"
  override val supportsSeconds = false

  override fun draw(input: FaceInput, out: DrawList) = with(input) {
    val hours = hourText(hour, options.h24)
    val digits = hours + two(minute)
    val info = infoLine()
    var s = min(right - left, bottom - top) * 0.3f * scale
    var infoS = if (info.isEmpty()) 0f else fitSize(info, s * 0.14f)
    var infoGap = infoS * 0.9f
    // Digit rows sit PITCH apart; the hour/minute split adds SPLIT.
    val total = lineHeight(s) + (digits.length - 1) * PITCH * s + SPLIT * s + (if (infoS > 0f) infoGap + lineHeight(infoS) else 0f)
    val k = min(1f, (bottom - top) / total)
    s *= k; infoS *= k; infoGap *= k
    val y0 = blockTop(total * k)
    val cx = centreX
    var y = y0 + TEXT_ASCENT * s
    for (i in digits.indices) {
      if (i == hours.length) y += SPLIT * s
      out.text(cx, y, s, digits[i].toString(), if (i < hours.length) main else accent, DrawList.BOLD, DrawList.CENTRE)
      if (i == hours.length - 1) {
        val ly = y + 0.26f * s // mid-gap between the hour digit's baseline and the next digit's top
        out.line(cx - s * 0.25f, ly, cx + s * 0.25f, ly, withAlpha(main, 0.5f), max(1.5f, s * 0.008f))
      }
      if (i < digits.length - 1) y += PITCH * s
    }
    if (infoS > 0f) out.text(cx, y0 + total * k - lineHeight(infoS) + TEXT_ASCENT * infoS, infoS, info, withAlpha(main, 0.75f), DrawList.REGULAR, DrawList.CENTRE)
  }

  private companion object {
    const val PITCH = 0.9f
    const val SPLIT = 0.3f
  }
}
