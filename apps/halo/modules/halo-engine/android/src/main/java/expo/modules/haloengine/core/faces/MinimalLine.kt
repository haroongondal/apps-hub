package expo.modules.haloengine.core.faces

import expo.modules.haloengine.core.DrawList
import expo.modules.haloengine.core.Face
import expo.modules.haloengine.core.FaceInput
import expo.modules.haloengine.core.TEXT_ADVANCE
import expo.modules.haloengine.core.TEXT_ASCENT
import expo.modules.haloengine.core.accent
import expo.modules.haloengine.core.blockTop
import expo.modules.haloengine.core.centreX
import expo.modules.haloengine.core.fitSize
import expo.modules.haloengine.core.infoLine
import expo.modules.haloengine.core.lineHeight
import expo.modules.haloengine.core.main
import expo.modules.haloengine.core.scale
import expo.modules.haloengine.core.timeText
import expo.modules.haloengine.core.withAlpha
import kotlin.math.max
import kotlin.math.min

/** Thin regular digits over one hairline; an accent dot rides the hairline from left to right as the minutes pass. */
class MinimalLine : Face {
  override val id = "minimal-line"
  override val name = "Minimal line"
  override val supportsSeconds = false

  override fun draw(input: FaceInput, out: DrawList) = with(input) {
    val time = timeText(hour, minute, options.h24)
    val info = infoLine()
    var s = fitSize(time, min(right - left, bottom - top) * 0.2f * scale)
    var infoS = if (info.isEmpty()) 0f else fitSize(info, s * 0.2f)
    var infoGap = infoS * 0.9f
    val total = lineHeight(s) + (if (infoS > 0f) infoGap + lineHeight(infoS) else 0f)
    val k = min(1f, (bottom - top) / total)
    s *= k; infoS *= k; infoGap *= k
    val y0 = blockTop(total * k)
    val cx = centreX
    val baseline = y0 + TEXT_ASCENT * s
    out.text(cx, baseline, s, time, main, DrawList.REGULAR, DrawList.CENTRE)
    val half = time.length * TEXT_ADVANCE * s / 2f
    val ruleY = baseline + 0.14f * s
    val width = max(1.5f, s * 0.008f)
    out.line(cx - half, ruleY, cx + half, ruleY, withAlpha(main, 0.5f), width)
    val r = max(2f, s * 0.03f)
    out.dot(cx - half + r + (2 * half - 2 * r) * minute / 59f, ruleY, r, accent, 0f)
    if (infoS > 0f) out.text(cx, y0 + lineHeight(s) + infoGap + TEXT_ASCENT * infoS, infoS, info, withAlpha(main, 0.75f), DrawList.REGULAR, DrawList.CENTRE)
  }
}
