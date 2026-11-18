package expo.modules.clipboardcore.core

import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Where the dragged bubble sits, as distances from the screen's right edge and
 * the keyboard's top, so the spot keeps its meaning when the keyboard resizes
 * (owner 2026-11-13: the fixed spot covered app content while typing).
 */
object BubblePlace {
  /** The finger moving left or up grows the distances, so the bubble follows it. */
  fun dragged(baseDx: Int, baseDy: Int, dxFinger: Float, dyFinger: Float) =
    (baseDx - dxFinger).roundToInt() to (baseDy - dyFinger).roundToInt()

  /** Clamps the distances so the whole bubble stays on screen (under [top] insets) and never sinks under the keyboard. */
  fun clamped(dx: Int, dy: Int, screenW: Int, above: Int, screenH: Int, size: Int, top: Int = 0) =
    dx.coerceIn(0, (screenW - size).coerceAtLeast(0)) to
      dy.coerceIn(0, (screenH - above - size - top).coerceAtLeast(0))

  /** Any direction past the slop starts a drag; the row swipe is sideways only, the bubble goes anywhere. */
  fun isDrag(dxFinger: Float, dyFinger: Float, slop: Int) = abs(dxFinger) > slop || abs(dyFinger) > slop
}
