package expo.modules.inflowcore.core

import java.time.ZoneId

/** Made by code, not by the model: a new transaction that MoneySurprise flags becomes a MONEY suggestion. Ledger calls onNew after it stores the transaction. */
class MoneySuggestions(
  private val ledger: LedgerStore, private val suggestions: SuggestionStore,
  private val settings: () -> AutopilotSettings, private val now: () -> Long, private val zone: ZoneId,
) {
  fun onNew(txnId: Long, itemId: Long) {
    val s = settings()
    if (SuggestionKind.MONEY !in s.kinds) return
    val t = ledger.get(txnId) ?: return
    val n = now()
    if (t.at < n - RECENT_MS) return   // a backfilled old message is no news (the suggestion would outlive the week it describes)
    // A pattern-read bank SMS has no category yet: its history is empty and only the "huge" and "new name" rules can fire.
    val history = t.category?.let { ledger.outHistory(it, t.currency, t.at - HISTORY_MS, txnId) }.orEmpty()
    if (!MoneySurprise.check(t.direction, t.amountMinor, t.currency, t.own, t.counterparty, history, ledger.knownCounterparties(txnId), s.surprise)) return
    suggestions.add(
      Suggestion(
        id = 0, kind = SuggestionKind.MONEY, title = SuggestionTitle.of(SuggestionKind.MONEY, t.counterparty, null, n, zone, moneyIn = t.direction == Direction.IN), itemId = itemId,
        dueAt = null, dedupeKey = "money:$txnId", state = SuggestionState.WAITING, createdAt = n, updatedAt = n, expiresAt = expiryFor(SuggestionKind.MONEY, n, null),
      ),
    )
  }

  private companion object {
    const val RECENT_MS = 7 * 86_400_000L
    const val HISTORY_MS = 90 * 86_400_000L
  }
}
