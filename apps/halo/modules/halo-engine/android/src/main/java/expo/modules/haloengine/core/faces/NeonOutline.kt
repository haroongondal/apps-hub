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

/** Seven-segment tube digits; each lit segment is three stacked strokes of falling width and rising alpha (no glow op), unlit segments are not drawn. */
class NeonOutline : Face {
  override val id = "neon-outline"
  override val name = "Neon outline"
  override val supportsSeconds = false

  override fun draw(input: FaceInput, out: DrawList) = with(input) {
    val text = (if (options.h24) two(hour) else hourText(hour, false)) + ":" + two(minute)
    val info = infoLine()
    var hgt = min(right - left, bottom - top) * 0.32f * scale
    // Digit 0.5 H wide, colon slot 0.1 H, 0.24 H between slots.
    val slots = text.length
    val widthUnits = (slots - 1) * 0.5f + 0.1f + slots * 0.24f
    var info0 = if (info.isEmpty()) 0f else fitSize(info, hgt * 0.14f)
    val k = min(1f, min((right - left) * 0.94f / (widthUnits * hgt), (bottom - top) / (hgt + (if (info0 > 0f) 0.18f * hgt + lineHeight(info0) else 0f))))
    hgt *= k; info0 *= k
    val gap = 0.18f * hgt
    val total = hgt + (if (info0 > 0f) gap + lineHeight(info0) else 0f)
    val y0 = blockTop(total)
    var x = centreX - widthUnits * hgt / 2f + 0.24f * hgt / 2f
    for (c in text) {
      if (c == ':') {
        for (y in floatArrayOf(0.3f, 0.7f)) {
          out.dot(x + 0.05f * hgt, y0 + y * hgt, 0.03f * hgt, withAlpha(accent, 0.16f), 0f)
          out.dot(x + 0.05f * hgt, y0 + y * hgt, 0.018f * hgt, withAlpha(accent, 0.4f), 0f)
          out.dot(x + 0.05f * hgt, y0 + y * hgt, max(1.5f, 0.008f * hgt), accent, 0f)
        }
        x += 0.1f * hgt + 0.24f * hgt
      } else {
        digit(out, c - '0', main, x, y0, 0.5f * hgt, hgt)
        x += 0.5f * hgt + 0.24f * hgt
      }
    }
    if (info0 > 0f) out.text(centreX, y0 + hgt + gap + TEXT_ASCENT * info0, info0, info, withAlpha(main, 0.75f), DrawList.REGULAR, DrawList.CENTRE)
  }

  private fun strokes(out: DrawList, colour: Int, hgt: Float, x0: Float, y0: Float, x1: Float, y1: Float) {
    out.line(x0, y0, x1, y1, withAlpha(colour, 0.16f), 0.055f * hgt)
    out.line(x0, y0, x1, y1, withAlpha(colour, 0.4f), 0.028f * hgt)
    out.line(x0, y0, x1, y1, colour, max(2f, 0.012f * hgt))
  }

  private fun digit(out: DrawList, d: Int, colour: Int, x0: Float, y0: Float, w: Float, h: Float) {
    val g = 0.05f * h
    val x1 = x0 + w
    val y1 = y0 + h
    val ym = y0 + h / 2f
    for (seg in SEGMENTS[d]) when (seg) {
      'a' -> strokes(out, colour, h, x0 + g, y0, x1 - g, y0)
      'b' -> strokes(out, colour, h, x1, y0 + g, x1, ym - g)
      'c' -> strokes(out, colour, h, x1, ym + g, x1, y1 - g)
      'd' -> strokes(out, colour, h, x0 + g, y1, x1 - g, y1)
      'e' -> strokes(out, colour, h, x0, ym + g, x0, y1 - g)
      'f' -> strokes(out, colour, h, x0, y0 + g, x0, ym - g)
      else -> strokes(out, colour, h, x0 + g, ym, x1 - g, ym)
    }
  }

  private companion object {
    val SEGMENTS = arrayOf("abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg", "abc", "abcdefg", "abcdfg")
  }
}
