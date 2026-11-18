package expo.modules.notchisland.core

data class PillBox(val xFromCenter: Int, val width: Int, val height: Int)

data class Cutout(val left: Int, val right: Int, val bottom: Int)

object PillGeometry {
  private const val FALLBACK_WIDTH_DP = 72
  private const val FALLBACK_HEIGHT_DP = 28
  private const val HUG_DP = 8
  private const val DROP_DP = 4
  private const val EXPANDED_WIDTH_DP = 300
  private const val EXPANDED_EXTRA_DP = 36
  private const val EDGE_DP = 16
  private const val ROW_DP = 40

  // The offset is from the screen's centre because that is what Gravity.CENTER_HORIZONTAL wants; a cutout reports its bounds from the left edge.
  fun collapsed(cutout: Cutout?, screenWidth: Int, density: Float): PillBox {
    if (cutout == null) return PillBox(0, (FALLBACK_WIDTH_DP * density).toInt(), (FALLBACK_HEIGHT_DP * density).toInt())
    return PillBox(
      xFromCenter = (cutout.left + cutout.right) / 2 - screenWidth / 2,
      width = cutout.right - cutout.left + 2 * (HUG_DP * density).toInt(),
      height = cutout.bottom + (DROP_DP * density).toInt(),
    )
  }

  fun expanded(cutout: Cutout?, screenWidth: Int, density: Float, rows: Int = 0): PillBox {
    val c = collapsed(cutout, screenWidth, density)
    val width = minOf((EXPANDED_WIDTH_DP * density).toInt(), screenWidth - 2 * (EDGE_DP * density).toInt())
    return c.copy(width = width, height = c.height + (EXPANDED_EXTRA_DP * density).toInt() + expandedRowsPx(rows, density))
  }

  // Each widget row under the clock and battery line.
  fun expandedRowsPx(rows: Int, density: Float): Int = rows * (ROW_DP * density).toInt()

  // Widening keeps xFromCenter, so the pill grows evenly on both sides of the hole.
  fun withIndicator(box: PillBox, extraPx: Int): PillBox = box.copy(width = box.width + extraPx)

  fun lerp(a: PillBox, b: PillBox, t: Float) = PillBox(
    xFromCenter = a.xFromCenter + ((b.xFromCenter - a.xFromCenter) * t).toInt(),
    width = a.width + ((b.width - a.width) * t).toInt(),
    height = a.height + ((b.height - a.height) * t).toInt(),
  )

  fun sizeScale(size: String): Float = when (size) {
    "compact" -> 0.85f
    "large" -> 1.15f
    else -> 1.0f
  }

  // Null means never fold back.
  fun foldDelayMs(foldMs: Int): Long? = if (foldMs == 0) null else foldMs.toLong()
}
