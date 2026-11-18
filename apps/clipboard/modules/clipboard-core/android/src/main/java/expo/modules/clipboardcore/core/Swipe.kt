package expo.modules.clipboardcore.core

import kotlin.math.abs

/** The same rules as the app's src/swipe.ts, so rows behave alike in the app and the bubble. */
object Swipe {
  private const val DISTANCE = 0.35f
  private const val FLING_PX_PER_S = 1000f

  fun direction(dx: Float, vx: Float, width: Int): Int = when {
    abs(dx) < width * DISTANCE && abs(vx) < FLING_PX_PER_S -> 0
    (if (dx != 0f) dx else vx) < 0 -> -1
    else -> 1
  }

  fun isSwipe(dx: Float, dy: Float, slop: Int): Boolean = abs(dx) > slop && abs(dx) > 2 * abs(dy)

  fun ago(at: Long, now: Long): String {
    val min = (now - at) / 60_000
    if (min < 1) return "just now"
    if (min < 60) return "$min min ago"
    val h = min / 60
    return if (h < 24) "$h h ago" else "${h / 24} d ago"
  }
}
