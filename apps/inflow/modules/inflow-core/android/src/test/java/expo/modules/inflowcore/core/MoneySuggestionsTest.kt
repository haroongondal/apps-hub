package expo.modules.inflowcore.core

import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MoneySuggestionsTest {
  private val now = 1_800_000_000_000L
  private val day = 86_400_000L
  private val ledgerStore = MemoryLedgerStore()
  private val suggestions = MemorySuggestionStore()
  private var settings = AutopilotSettings()
  private val hook = MoneySuggestions(ledgerStore, suggestions, { settings }, { now }, ZoneId.of("Asia/Karachi"))
  private val ledger = Ledger(ledgerStore, { null }, hook::onNew)
  private var item = 1L

  private fun ai(amount: Long, direction: Direction = Direction.OUT, name: String? = "Shop", category: String = "Food", own: Boolean = false, at: Long = now) =
    ledger.onAi(item++, AiMoney(direction, own, amount, "PKR", null, name, category), Channel.SMS, at)

  @Test fun aDebitFarAboveTheCategoryUsualIsFlagged() {
    ai(1_000_00, at = now - 3 * day); ai(1_200_00, at = now - 2 * day); ai(1_100_00, at = now - day)
    assertTrue(suggestions.rows.isEmpty())
    val id = ai(6_000_00, name = "Burger Hub")!!
    val s = suggestions.rows.values.single()
    assertEquals(SuggestionKind.MONEY, s.kind)
    assertEquals("money:$id", s.dedupeKey)
    assertEquals("Large debit at Burger Hub", s.title)
    assertEquals(item - 1, s.itemId)
    assertEquals(now + 7 * day, s.expiresAt)
    assertEquals(SuggestionState.WAITING, s.state)
  }

  @Test fun historyOlderThan90DaysDoesNotCount() {
    ai(1_000_00, at = now - 100 * day)
    ai(6_000_00)
    assertTrue(suggestions.rows.isEmpty())   // no history: only the huge rule could fire
  }

  @Test fun aHugeDebitIsFlaggedWithoutHistory() {
    ai(60_000_00)
    assertEquals(1, suggestions.rows.size)
  }

  @Test fun moneyInFromANameNeverSeenIsFlaggedOnce() {
    ai(2_000_00, Direction.IN, name = "Stranger")
    ai(2_000_00, Direction.IN, name = "stranger", at = now + 1)   // same name, any case: known now
    assertEquals(1, suggestions.rows.size)
  }

  @Test fun anOwnTransferIsNeverFlagged() {
    ai(60_000_00, own = true)
    assertTrue(suggestions.rows.isEmpty())
  }

  @Test fun anotherCurrencyIsNeverFlagged() {
    ledger.onAi(99, AiMoney(Direction.OUT, false, 90_000_000, "USD", null, "Shop", "Food"), Channel.SMS, now)
    assertTrue(suggestions.rows.isEmpty())
  }

  @Test fun theKindSwitchedOffMakesNothing() {
    settings = AutopilotSettings(kinds = setOf(SuggestionKind.REPLY))
    ai(60_000_00)
    assertTrue(suggestions.rows.isEmpty())
  }

  @Test fun anOldMessageFromABackfillMakesNothing() {
    ai(60_000_00, at = now - 8 * day)
    assertTrue(suggestions.rows.isEmpty())
  }

  @Test fun aTransactionThatOnlyGainsASourceMakesNoSecondSuggestion() {
    ai(60_000_00)
    ledger.onAi(item++, AiMoney(Direction.OUT, false, 60_000_00, "PKR", null, "Shop", "Food"), Channel.EMAIL, now + 1_000)
    assertEquals(1, suggestions.rows.size)
  }

  @Test fun aThrowingHookNeverFailsTheLedger() {
    val l = Ledger(ledgerStore, { null }) { _, _ -> error("boom") }
    assertTrue(l.onAi(77, AiMoney(Direction.OUT, false, 1_000, "PKR", null, "Shop", "Food"), Channel.SMS, now) != null)
  }

  @Test fun aPatternBankSmsHasNoCategoryButMoneyInFromANewNameStillFires() {
    val id = ledger.onItem(
      item++,
      "PKR 75,000 received from HAROON MUKHTAR* in your UBL A/C *1733 on 01-OCT-2026 21:03 via your Raast ID. Tx ID 7224343340. For info 111825888.",
      Channel.SMS, now,
    )!!
    assertEquals("money:$id", suggestions.rows.values.single().dedupeKey)   // money in from a name never seen
  }
}
