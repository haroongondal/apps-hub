package expo.modules.inflowcore.core

/** What the owner may type when editing a transaction name or a to-do: trimmed, blank means "none", never longer than the limit. */
object Edits {
  const val MAX_TODO = 200
  const val MAX_LABEL = 100

  /** Null when blank: a to-do needs text. */
  fun todoText(raw: String?): String? = raw?.trim()?.takeIf { it.isNotEmpty() }?.take(MAX_TODO)

  /** Null when blank: the clean name is cleared. */
  fun label(raw: String?): String? = raw?.trim()?.takeIf { it.isNotEmpty() }?.take(MAX_LABEL)

}
