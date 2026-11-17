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
import expo.modules.haloengine.core.hourText
import expo.modules.haloengine.core.infoLine
import expo.modules.haloengine.core.lineHeight
import expo.modules.haloengine.core.main
import expo.modules.haloengine.core.scale
import expo.modules.haloengine.core.two
import expo.modules.haloengine.core.withAlpha
import kotlin.math.max
import kotlin.math.min

/** A huge bold hour with the minutes small in the accent colour on the same baseline, split by a hairline. */
class BigHour : Face {
  override val id = "big-hour"
  override val name = "Big hour"
  override val supportsSeconds = false

  override fun draw(input: FaceInput, out: DrawList) = with(input) {
    val h = hourText(hour, options.h24)
    val m = two(minute)
    val info = infoLine()
    // Group width in em of the hour size: hour digits, gap, minutes at MIN em.
    val em = h.length * TEXT_ADVANCE + GAP + m.length * TEXT_ADVANCE * MIN
    var s = min(min(right - left, bottom - top) * 0.55f * scale, (right - left) / em)
    var ms = s * MIN
    var gap = s * GAP
    var infoS = if (info.isEmpty()) 0f else fitSize(info, s * 0.11f)
    var infoGap = infoS * 0.9f
    val total = lineHeight(s) + (if (infoS > 0f) infoGap + lineHeight(infoS) else 0f)
    val k = min(1f, (bottom - top) / total)
    s *= k; ms *= k; gap *= k; infoS *= k; infoGap *= k
    val y0 = blockTop(total * k)
    val hw = h.length * TEXT_ADVANCE * s
    val x0 = centreX - (hw + gap + m.length * TEXT_ADVANCE * ms) / 2f
    val baseline = y0 + TEXT_ASCENT * s
    out.text(x0, baseline, s, h, main, DrawList.BOLD, DrawList.LEFT)
    out.text(x0 + hw + gap, baseline, ms, m, accent, DrawList.BOLD, DrawList.LEFT)
    val sx = x0 + hw + gap * 0.5f
    out.line(sx, baseline - 0.68f * s, sx, baseline, withAlpha(accent, 0.6f), max(1.5f, s * 0.006f))
    if (infoS > 0f) out.text(centreX, y0 + lineHeight(s) + infoGap + TEXT_ASCENT * infoS, infoS, info, withAlpha(main, 0.75f), DrawList.REGULAR, DrawList.CENTRE)
  }

  private companion object {
    const val MIN = 0.3f
    const val GAP = 0.1f
  }
}
