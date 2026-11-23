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

/** Two flap cards (hours, minutes), each a thin outline with a hairline split across the middle; no filled shapes. */
class SplitFlap : Face {
  override val id = "split-flap"
  override val name = "Split flap"
  override val supportsSeconds = false
  private val rect = FloatArray(8)

  override fun draw(input: FaceInput, out: DrawList) = with(input) {
    val h = if (options.h24) two(hour) else hourText(hour, false)
    val m = two(minute)
    val info = infoLine()
    // Card = digits + 0.4 s padding; 0.25 s between the cards; card height 1.24 s (digits are 0.68 s tall).
    var s = min(min(right - left, bottom - top) * 0.3f * scale, (right - left) / ((h.length + m.length) * TEXT_ADVANCE + 1.05f))
    var info0 = if (info.isEmpty()) 0f else fitSize(info, s * 0.2f)
    var gap = info0 * 0.8f
    var total = 1.24f * s + (if (info0 > 0f) gap + lineHeight(info0) else 0f)
    val k = min(1f, (bottom - top) / total)
    s *= k; info0 *= k; gap *= k; total *= k
    val cy = blockTop(total) + 0.62f * s
    val wH = h.length * TEXT_ADVANCE * s + 0.4f * s
    val wM = m.length * TEXT_ADVANCE * s + 0.4f * s
    var x = centreX - (wH + wM + 0.25f * s) / 2f
    for ((text, w, colour) in listOf(Triple(h, wH, main), Triple(m, wM, accent))) {
      rect[0] = x; rect[1] = cy - 0.62f * s; rect[2] = x + w; rect[3] = rect[1]
      rect[4] = x + w; rect[5] = cy + 0.62f * s; rect[6] = x; rect[7] = rect[5]
      out.polyline(rect, 4, withAlpha(colour, 0.55f), max(1.5f, 0.02f * s), 0f, true)
      out.line(x, cy, x + w, cy, withAlpha(colour, 0.35f), max(1f, 0.012f * s))
      out.text(x + w / 2f, cy + 0.34f * s, s, text, colour, DrawList.BOLD, DrawList.CENTRE)
      x += w + 0.25f * s
    }
    if (info0 > 0f) out.text(centreX, cy + 0.62f * s + gap + TEXT_ASCENT * info0, info0, info, withAlpha(main, 0.75f), DrawList.REGULAR, DrawList.CENTRE)
  }
}
