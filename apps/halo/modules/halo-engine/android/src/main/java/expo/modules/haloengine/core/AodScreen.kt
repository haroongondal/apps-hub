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
  const val POCKET_END_MS = 3_000L
  // shortcut: the always-on edge draws about 15 frames a second, not every display frame (it blurs a full-screen layer each frame, which kept the GPU busy for the whole timeout); upgrade if it looks choppy on the owner's phone.
  const val EDGE_FRAME_MS = 66L
  private const val NEAR_CM = 5f

  fun timeoutMs(themeMs: Long?, wake: Boolean): Long? = if (wake) WAKE_MS else themeMs

  /** Some proximity sensors report only 0 or their max range, others a distance in cm. */
  fun near(distance: Float, maxRange: Float) = distance < minOf(maxRange, NEAR_CM)

  /** The theme to switch to when a time slot changed while showing; null keeps the current one. */
  fun switchTheme(aod: SettingsAod, themes: List<Theme>, minuteOfDay: Int, currentId: String): Theme? =
    Themes.resolve(aod, themes, minuteOfDay).takeIf { it.id != currentId }
}

/** The pocket ends the always-on screen only once the sensor stayed covered for POCKET_END_MS; a hand passing over does not. */
class PocketTimer {
  private var nearSince: Long? = null

  fun update(near: Boolean, nowMs: Long) {
    nearSince = if (near) nearSince ?: nowMs else null
  }

  fun ended(nowMs: Long): Boolean = nearSince?.let { nowMs - it >= AodScreen.POCKET_END_MS } ?: false
}

data class IconCount(val pkg: String, val count: Int)

data class NoteGroup(val pkg: String, val category: String?, val count: Int)

/** Package names and categories only, never title or text; NotifyRules' filter (what never flashes never shows an icon), minus notes hidden on the lock screen. */
class NoteIcons(private val ownPkg: String, private val cap: Int = 200) {
  private val notes = LinkedHashMap<String, Pair<String, String?>>()

  fun posted(n: PostedNote): Boolean {
    if (!NotifyRules.eligible(n, ownPkg) || n.secret) return false
    notes.remove(n.key)
    notes[n.key] = n.pkg to n.category
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
    for ((pkg) in notes.values.reversed()) counts[pkg] = (counts[pkg] ?: 0) + 1
    return counts.entries.take(max).map { IconCount(it.key, it.value) }
  }

  /** Newest group first. */
  fun groups(): List<NoteGroup> {
    val counts = LinkedHashMap<Pair<String, String?>, Int>()
    for (g in notes.values.reversed()) counts[g] = (counts[g] ?: 0) + 1
    return counts.map { (g, n) -> NoteGroup(g.first, g.second, n) }
  }
}
