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
import expo.modules.haloengine.core.withAlpha
import kotlin.math.min

/**
 * Hours, minutes (and seconds) as rows of binary dots, most significant bit on the left: a lit dot is a 1, a faint speck a 0.
 * Hours always use the 0-23 value (5 dots, accent), so h24 is ignored: 1 pm reads 13 either way. Rows are right-aligned in a 6-column grid.
 */
class BinaryDots : Face {
  override val id = "binary-dots"
  override val name = "Binary dots"
  override val supportsSeconds = true

  override fun draw(input: FaceInput, out: DrawList) = with(input) {
    val rows = if (options.seconds) 3 else 2
    val info = infoLine()
    var cell = min((right - left) / COLS, (bottom - top) / 6f) * 0.85f * scale
    cell = min(cell, (right - left) / COLS)
    var size = if (info.isEmpty()) 0f else fitSize(info, cell * 0.4f)
    var gap = size * 1.2f
    var total = rows * cell + gap + lineHeight(size)
    if (total > bottom - top) {
      val k = (bottom - top) / total
      cell *= k; size *= k; gap *= k; total *= k
    }
    val y0 = blockTop(total)
    val x0 = centreX - COLS * cell / 2f
    val values = intArrayOf(hour, minute, second)
    val bits = intArrayOf(5, 6, 6)
    for (row in 0 until rows) {
      val colour = if (row == 0) accent else main
      for (i in 0 until bits[row]) {
        val col = COLS - bits[row] + i
        val lit = isLit(values[row], bits[row], i)
        out.dot(x0 + (col + 0.5f) * cell, y0 + (row + 0.5f) * cell,
          if (lit) cell * LIT else cell * SPECK, if (lit) colour else withAlpha(colour, 0.35f), 0f)
      }
    }
    if (size > 0f) out.text(centreX, y0 + rows * cell + gap + TEXT_ASCENT * size, size, info, withAlpha(main, 0.75f), DrawList.REGULAR, DrawList.CENTRE)
  }

  companion object {
    const val COLS = 6
    const val LIT = 0.3f
    const val SPECK = 0.06f

    /** Bit i of `value`, counted from the most significant of `bits`. */
    fun isLit(value: Int, bits: Int, i: Int): Boolean = (value shr (bits - 1 - i)) and 1 == 1
  }
}
