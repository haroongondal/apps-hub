package expo.modules.inflowcore.core

/** A notification title that says nothing about who wrote ("1 new message"): never a chat name. SQL twin: SqlItemStore.GENERIC_SQL. */
object GenericTitle {
  private val RE = Regex("^(\\d+ )?new messages?$", RegexOption.IGNORE_CASE)

  fun isGeneric(title: String?): Boolean = title != null && RE.matches(title.trim())
}
