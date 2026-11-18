package expo.modules.inflowcore.core

/** The one category list (owner-approved, 2026-11-17). Money out and money in have their own half; the direction decides which applies. */
object Categories {
  val OUT: List<String> = listOf(
    "Food & dining", "Groceries", "Shopping", "Mobile & internet", "Bills & utilities", "Rent", "Transport", "Fuel", "Health",
    "Education", "Entertainment", "Travel", "Family", "Charity", "Sent to people", "Fees & charges", "Cash withdrawal", "Other",
  )
  val IN: List<String> = listOf("Salary", "Received from people", "Refund", "Other income")

  /** The names the schema v6 migration renames, old to new (money out only). */
  val RENAMED: Map<String, String> = mapOf("Food" to "Food & dining", "Bills" to "Bills & utilities", "Fees" to "Fees & charges")

  fun forDirection(d: Direction): List<String> = if (d == Direction.IN) IN else OUT

  fun fallback(d: Direction): String = if (d == Direction.IN) "Other income" else "Other"

  /** An old stored value in the new list: renamed, kept, or null when it does not fit the direction (it is then categorised again). */
  fun migrate(old: String?, d: Direction): String? {
    val name = RENAMED[old] ?: old
    return name?.takeIf { it in forDirection(d) }
  }

  /** The model's word (any case) as one of the direction's names, else null. */
  fun canonical(name: String?, d: Direction): String? =
    forDirection(d).firstOrNull { it.equals(name?.trim(), ignoreCase = true) }

  /** `canonical`, else the direction's fallback. */
  fun match(name: String?, d: Direction): String = canonical(name, d) ?: fallback(d)
}
