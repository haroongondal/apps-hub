package expo.modules.haloengine.core

object Themes {
  private const val FALLBACK_FACE = "big-digits"

  /** The slot with the latest start <= minuteOfDay wins; before the first slot, the last slot of the day before (crosses midnight). */
  fun resolve(aod: SettingsAod, themes: List<Theme>, minuteOfDay: Int): Theme {
    val pool = themes.ifEmpty { starter() }
    val slots = aod.slots.mapNotNull { s -> minutes(s.start)?.let { it to s.themeId } }.sortedBy { it.first }
    val slotId = (slots.lastOrNull { it.first <= minuteOfDay } ?: slots.lastOrNull())?.second
    return pool.firstOrNull { it.id == slotId } ?: pool.firstOrNull { it.id == aod.themeId } ?: pool.first()
  }

  /** The starter themes with faces that exist (the stored "mono" names a face that is not built). */
  fun starter(): List<Theme> {
    val ids = Faces.all.map { it().id }.toSet()
    return STARTER_THEMES.map { usable(it, ids, photoExists = false) }
  }

  /** An unknown face becomes big-digits and a photo whose file is gone is switched off. */
  fun usable(theme: Theme, faceIds: Set<String>, photoExists: Boolean): Theme =
    theme.copy(face = theme.face.takeIf { it in faceIds } ?: FALLBACK_FACE, photo = theme.photo && photoExists)

  private fun minutes(t: String): Int? {
    val h = t.substringBefore(':', "").toIntOrNull() ?: return null
    val m = t.substringAfter(':', "").toIntOrNull() ?: return null
    return if (h in 0..23 && m in 0..59) h * 60 + m else null
  }
}
