package expo.modules.pdfscan.core

import kotlin.math.min
import kotlin.math.roundToInt

// A4 at 300 dpi with ID-1 cards (85.6 x 53.98 mm) at actual size; rects are left, top, right, bottom.
object SheetLayout {
  const val WIDTH = 2480
  const val HEIGHT = 3508
  const val CARD_W = 1011
  const val CARD_H = 637
  const val GAP = 118

  fun cardRects(hasBack: Boolean): List<IntArray> {
    val left = (WIDTH - CARD_W) / 2
    val top = (HEIGHT - (CARD_H * 2 + GAP)) / 2
    val front = intArrayOf(left, top, left + CARD_W, top + CARD_H)
    if (!hasBack) return listOf(front)
    val backTop = top + CARD_H + GAP
    return listOf(front, intArrayOf(left, backTop, left + CARD_W, backTop + CARD_H))
  }

  /** Where a w x h card image lands in [rect]: turned a quarter when portrait, aspect kept, centred. */
  fun fit(w: Int, h: Int, rect: IntArray): Pair<Boolean, IntArray> {
    val turn = h > w
    val ew = if (turn) h else w
    val eh = if (turn) w else h
    val rw = rect[2] - rect[0]
    val rh = rect[3] - rect[1]
    val scale = min(rw.toDouble() / ew, rh.toDouble() / eh)
    val dw = (ew * scale).roundToInt()
    val dh = (eh * scale).roundToInt()
    val x = rect[0] + (rw - dw) / 2
    val y = rect[1] + (rh - dh) / 2
    return turn to intArrayOf(x, y, x + dw, y + dh)
  }
}
