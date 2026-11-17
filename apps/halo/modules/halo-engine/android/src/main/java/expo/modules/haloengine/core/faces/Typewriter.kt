package expo.modules.haloengine.core.faces

import expo.modules.haloengine.core.DrawList
import expo.modules.haloengine.core.Face
import expo.modules.haloengine.core.FaceInput
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

// Real advance of the bundled mono font per px of text size.
const val MONO_ADVANCE = 0.63f

/** A terminal line `> 14:07` with an outlined cursor cell right after the text, so the cursor moves when the digit count changes; seconds are ignored. */
class Typewriter : Face {
  override val id = "typewriter"
  override val name = "Typewriter"
  override val supportsSeconds = false
  private val box = FloatArray(10)

  override fun draw(input: FaceInput, out: DrawList) = with(input) {
    val time = timeText(hour, minute, options.h24)
    val cols = 2 + time.length + 1
    val want = min(right - left, bottom - top) * 0.2f * scale
    var t = fitSize(" ".repeat(cols), want)
    val info = infoLine()
    var s = if (info.isEmpty()) 0f else fitSize(info, t * 0.22f)
    var total = lineHeight(t) + if (s > 0f) 0.3f * t + lineHeight(s) else 0f
    val k = min(1f, (bottom - top) / total)
    t *= k; s *= k; total *= k
    val y0 = blockTop(total)
    val base = y0 + TEXT_ASCENT * t
    val x0 = centreX - cols * MONO_ADVANCE * t / 2f
    out.text(x0, base, t, ">", accent, DrawList.MONO, DrawList.LEFT)
    out.text(x0 + 2 * MONO_ADVANCE * t, base, t, time, main, DrawList.MONO, DrawList.LEFT)
    val cx = x0 + (2 + time.length) * MONO_ADVANCE * t
    val l = cx + 0.06f * t
    val r = cx + 0.57f * t
    val cTop = base - 0.68f * t
    // Two thin outlines of falling alpha read as a block without lighting a filled rectangle.
    for ((inset, alpha) in listOf(0f to 1f, 0.05f * t to 0.4f)) {
      val a = l + inset; val b = r - inset; val c = cTop + inset; val d = base - inset
      box[0] = a; box[1] = c; box[2] = b; box[3] = c; box[4] = b; box[5] = d; box[6] = a; box[7] = d
      out.polyline(box, 4, withAlpha(accent, alpha), max(2f, t * 0.025f), 0f, true)
    }
    if (s > 0f) out.text(centreX, base + t * (0.24f + 0.3f) + TEXT_ASCENT * s, s, info, withAlpha(main, 0.6f), DrawList.MONO, DrawList.CENTRE)
  }
}
