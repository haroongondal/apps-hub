package expo.modules.inflowcore.core

object MoneySurprise {
  /** A debit well above the category's usual size, a huge debit, or money in from a name never seen. Amounts are minor units. */
  // shortcut: PKR only; a second currency would need its own thresholds.
  fun check(
    direction: Direction, amountMinor: Long, currency: String, own: Boolean, counterparty: String?,
    categoryHistoryMinor: List<Long>, knownCounterparties: Set<String>, cfg: MoneySurpriseConfig,
  ): Boolean {
    if (own || !currency.trim().equals("PKR", ignoreCase = true)) return false
    return when (direction) {
      Direction.OUT -> amountMinor > cfg.hugeMinor ||
        (categoryHistoryMinor.isNotEmpty() && amountMinor >= cfg.minMinor && amountMinor >= cfg.multiple * median(categoryHistoryMinor))
      Direction.IN -> {
        val name = counterparty?.trim()?.lowercase().orEmpty()
        name.isNotEmpty() && knownCounterparties.none { it.trim().lowercase() == name }
      }
    }
  }

  private fun median(v: List<Long>): Long {
    val s = v.sorted()
    val m = s.size / 2
    return if (s.size % 2 == 1) s[m] else (s[m - 1] + s[m]) / 2
  }
}
