package expo.modules.notchisland.core

data class PillBox(val xFromCenter: Int, val width: Int, val height: Int)

data class Cutout(val left: Int, val right: Int, val bottom: Int)

object PillGeometry {
  private const val FALLBACK_HOLE_DP = 56
  private const val FALLBACK_HEIGHT_DP = 28
  private const val HUG_DP = 8
  private const val DROP_DP = 4
  private const val CLOSED_SCREEN_SHARE = 0.32f
  private const val CLOSED_EDGE_DP = 16
  private const val EXPANDED_EDGE_DP = 11
  private const val PILL_RADIUS_MAX_DP = 44
  private const val BASE_SHORT_DP = 84
  private const val BASE_MEDIA_DP = 160
  private const val BASE_EXTRA_ROW_DP = 64

  const val INSET_SIDE_DP = 20
  const val INSET_BELOW_HOLE_DP = 16
  const val INSET_BOTTOM_DP = 16
  const val DATE_LINE_DP = 20
  const val ROW_GAP_DP = 12

  fun rowDp(kind: String): Int = when (kind) {
    "media" -> 128
    "timer" -> 88
    "event" -> 48
    "progress" -> 64
    else -> 44
  }

  fun collapsed(cutout: Cutout?, screenWidth: Int, density: Float, scale: Float = 1f): PillBox {
    val holeWidth = cutout?.let { it.right - it.left } ?: px(FALLBACK_HOLE_DP, density)
    val natural = maxOf(holeWidth + 2 * px(HUG_DP, density), (CLOSED_SCREEN_SHARE * screenWidth).toInt())
    return PillBox(
      xFromCenter = cutout?.let { (it.left + it.right) / 2 - screenWidth / 2 } ?: 0,
      width = minOf((natural * scale).toInt(), screenWidth - 2 * px(CLOSED_EDGE_DP, density)),
      height = cutout?.let { it.bottom + px(DROP_DP, density) } ?: px(FALLBACK_HEIGHT_DP, density),
    )
  }

  fun expanded(cutout: Cutout?, screenWidth: Int, density: Float, rows: List<String> = emptyList()): PillBox {
    val c = collapsed(cutout, screenWidth, density)
    val width = screenWidth - 2 * px(EXPANDED_EDGE_DP, density)
    val room = (screenWidth - width) / 2
    return PillBox(c.xFromCenter.coerceIn(-room, room), width, expandedHeight(c.height, rows, density))
  }

  // max(base 84, or 160 with media, +64 per row past the first; hole row + (date line 20, or 16 + rows + 12 between) + 16 bottom):
  // the iPhone sizes hold under a shallow hole and nothing clips under a deep one.
  fun expandedHeight(holeRow: Int, rows: List<String>, density: Float): Int {
    val base = (if ("media" in rows) BASE_MEDIA_DP else BASE_SHORT_DP) + BASE_EXTRA_ROW_DP * maxOf(0, rows.size - 1)
    val content = if (rows.isEmpty()) DATE_LINE_DP else INSET_BELOW_HOLE_DP + rows.sumOf(::rowDp) + ROW_GAP_DP * (rows.size - 1)
    return maxOf(px(base, density), holeRow + px(content + INSET_BOTTOM_DP, density))
  }

  fun withIndicator(box: PillBox, extraPx: Int): PillBox = box.copy(width = box.width + extraPx)

  fun lerp(a: PillBox, b: PillBox, t: Float, maxWidth: Int = Int.MAX_VALUE) = PillBox(
    xFromCenter = a.xFromCenter + ((b.xFromCenter - a.xFromCenter) * t).toInt(),
    width = (a.width + ((b.width - a.width) * t).toInt()).coerceIn(0, maxWidth),
    height = (a.height + ((b.height - a.height) * t).toInt()).coerceAtLeast(0),
  )

  fun radius(corners: String, height: Int, density: Float): Float = when (corners) {
    "squared" -> 6 * density
    "rounded" -> 28 * density
    else -> minOf(PILL_RADIUS_MAX_DP * density, height / 2f)
  }

  fun sizeScale(size: String): Float = when (size) {
    "compact" -> 0.85f
    "large" -> 1.15f
    else -> 1.0f
  }

  fun foldDelayMs(foldMs: Int): Long? = if (foldMs == 0) null else foldMs.toLong()

  fun px(dp: Int, density: Float): Int = (dp * density).toInt()
}
