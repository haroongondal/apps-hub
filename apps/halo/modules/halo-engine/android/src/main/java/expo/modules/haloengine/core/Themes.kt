package expo.modules.haloengine.core

object Themes {
  private const val FALLBACK_FACE = "big-digits"
  private val ID = Regex("^[a-z0-9-]{1,40}$")

  /** Theme ids end up in file names, so only this shape may reach a path. */
  fun validId(id: String): Boolean = ID.matches(id)

  /** True for a preview PNG named `<id>-<millis>.png`; theme-1 must not match theme-10's files. */
  fun isPreviewOf(id: String, fileName: String): Boolean = Regex("^${Regex.escape(id)}-\\d+\\.png$").matches(fileName)

  /** Size that fits `maxPx` on the long side, keeping the ratio; never enlarges. */
  fun fit(w: Int, h: Int, maxPx: Int): Pair<Int, Int> {
    val long = maxOf(w, h)
    if (long <= maxPx) return w to h
    val k = maxPx.toDouble() / long
    return maxOf(1, Math.round(w * k).toInt()) to maxOf(1, Math.round(h * k).toInt())
  }

  /** The slot with the latest start <= minuteOfDay wins; before the first slot, the last slot of the day before (crosses midnight). */
  fun resolve(aod: SettingsAod, themes: List<Theme>, minuteOfDay: Int): Theme {
    val pool = themes.ifEmpty { starter() }
    val slots = aod.slots.mapNotNull { s -> minutes(s.start)?.let { it to s.themeId } }.sortedBy { it.first }
    val slotId = (slots.lastOrNull { it.first <= minuteOfDay } ?: slots.lastOrNull())?.second
    return pool.firstOrNull { it.id == slotId } ?: pool.firstOrNull { it.id == aod.themeId } ?: pool.first()
  }

  fun starter(): List<Theme> = STARTER_THEMES

  /** An unknown face becomes big-digits and a photo whose file is gone is switched off. */
  fun usable(theme: Theme, faceIds: Set<String>, photoExists: Boolean): Theme =
    theme.copy(face = theme.face.takeIf { it in faceIds } ?: FALLBACK_FACE, photo = theme.photo && photoExists)

  private fun minutes(t: String): Int? {
    val h = t.substringBefore(':', "").toIntOrNull() ?: return null
    val m = t.substringAfter(':', "").toIntOrNull() ?: return null
    return if (h in 0..23 && m in 0..59) h * 60 + m else null
  }
}
