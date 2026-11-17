package expo.modules.haloengine.core

import kotlin.math.abs

enum class AodAction { NONE, LEAVE, PLAY_PAUSE, NEXT, PREVIOUS }

object AodGestures {
  fun doubleTap(pocket: Boolean) = if (pocket) AodAction.NONE else AodAction.LEAVE

  fun singleTap(onCard: Boolean, pocket: Boolean, preview: Boolean) = when {
    pocket -> AodAction.NONE
    preview -> AodAction.LEAVE
    onCard -> AodAction.PLAY_PAUSE
    else -> AodAction.NONE
  }

  fun fling(onCard: Boolean, pocket: Boolean, dx: Float, dy: Float, minPx: Float): AodAction {
    if (pocket || !onCard || abs(dx) < minPx || abs(dx) < 2 * abs(dy)) return AodAction.NONE
    return if (dx < 0) AodAction.NEXT else AodAction.PREVIOUS
  }
}

object AodScreen {
  const val WAKE_MS = 10_000L
  private const val NEAR_CM = 5f

  fun timeoutMs(themeMs: Long?, wake: Boolean): Long? = if (wake) WAKE_MS else themeMs

  /** Some proximity sensors report only 0 or their max range, others a distance in cm. */
  fun near(distance: Float, maxRange: Float) = distance < minOf(maxRange, NEAR_CM)
}

data class IconCount(val pkg: String, val count: Int)

/** Package names only, never title or text; same filter as NotifyRules, so what never flashes never shows an icon. */
class NoteIcons(private val ownPkg: String, private val cap: Int = 200) {
  private val notes = LinkedHashMap<String, String>()

  fun posted(n: PostedNote): Boolean {
    if (n.pkg == ownPkg || n.ongoing || n.importance < IMPORTANCE_DEFAULT || n.groupSummary) return false
    notes.remove(n.key)
    notes[n.key] = n.pkg
    while (notes.size > cap) notes.remove(notes.keys.first())
    return true
  }

  fun removed(key: String): Boolean = notes.remove(key) != null

  fun reset(active: List<PostedNote>) {
    notes.clear()
    active.sortedBy { it.postedAtMs }.forEach(::posted)
  }

  fun top(max: Int = 6): List<IconCount> {
    val counts = LinkedHashMap<String, Int>()
    for (pkg in notes.values.reversed()) counts[pkg] = (counts[pkg] ?: 0) + 1
    return counts.entries.take(max).map { IconCount(it.key, it.value) }
  }

  private companion object {
    const val IMPORTANCE_DEFAULT = 3
  }
}
