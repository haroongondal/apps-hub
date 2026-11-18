package expo.modules.inflowcore.core

import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SuggestionTest {
  private val karachi = ZoneId.of("Asia/Karachi")
  private fun at(y: Int, mo: Int, d: Int, h: Int = 0, mi: Int = 0) = ZonedDateTime.of(y, mo, d, h, mi, 0, 0, karachi).toInstant().toEpochMilli()
  private val now = at(2026, 11, 18, 9, 30)
  private fun title(kind: SuggestionKind, name: String? = null, dueAt: Long? = null) = SuggestionTitle.of(kind, name, dueAt, now, karachi)

  @Test fun replyTitles() {
    assertEquals("Reply to Ali", title(SuggestionKind.REPLY, "Ali"))
    assertEquals("Reply in a chat", title(SuggestionKind.REPLY, null))
    assertEquals("Reply in a chat", title(SuggestionKind.REPLY, "  \n "))
  }

  @Test fun billTitle() {
    assertEquals("Bill due 25 Nov", title(SuggestionKind.BILL, null, at(2026, 11, 25)))
    assertEquals("Bill due 3 Dec", title(SuggestionKind.BILL, "K-Electric", at(2026, 12, 3)))
    assertEquals("Bill due soon", title(SuggestionKind.BILL))
  }

  @Test fun eventTitles() {
    // Always the absolute date, never today or tomorrow: the title is stored and read the next day too.
    assertEquals("Meeting 11:00 on 19 Nov", title(SuggestionKind.EVENT, null, at(2026, 11, 19, 11, 0)))
    assertEquals("Meeting 16:05 on 18 Nov", title(SuggestionKind.EVENT, null, at(2026, 11, 18, 16, 5)))
    assertEquals("Meeting 09:00 on 3 Dec", title(SuggestionKind.EVENT, null, at(2026, 12, 3, 9, 0)))
    assertEquals("Meeting 11:00 on 20 Nov", title(SuggestionKind.EVENT, null, at(2026, 11, 20, 11, 0)))
    assertEquals("Meeting 11:00 on 17 Nov", title(SuggestionKind.EVENT, null, at(2026, 11, 17, 11, 0)))
    assertEquals("Meeting soon", title(SuggestionKind.EVENT))
  }

  @Test fun moneyTitles() {
    assertEquals("Large debit at Alfalah", title(SuggestionKind.MONEY, "Alfalah"))
    assertEquals("Unusual payment", title(SuggestionKind.MONEY, null))
    assertEquals("Money in from Ali", SuggestionTitle.of(SuggestionKind.MONEY, "Ali", null, now, karachi, moneyIn = true))
    assertEquals("Money in from someone new", SuggestionTitle.of(SuggestionKind.MONEY, null, null, now, karachi, moneyIn = true))
    assertEquals("Money in from " + "x".repeat(40), SuggestionTitle.of(SuggestionKind.MONEY, "x".repeat(60), null, now, karachi, moneyIn = true))
  }

  @Test fun nameIsCollapsedAndCut() {
    assertEquals("Reply to Ali Khan", title(SuggestionKind.REPLY, "Ali\n  Khan"))
    val cut = title(SuggestionKind.REPLY, "x".repeat(60))
    assertEquals("Reply to " + "x".repeat(40), cut)
    assertFalse(title(SuggestionKind.MONEY, "a\nb").contains('\n'))
  }

  @Test fun expiry() {
    val h = 3_600_000L
    val day = 24 * h
    val created = at(2026, 11, 18, 9)
    val due = at(2026, 11, 25)
    assertEquals(created + day, expiryFor(SuggestionKind.REPLY, created, null))
    assertEquals(created + day, expiryFor(SuggestionKind.REPLY, created, due))
    assertEquals(due, expiryFor(SuggestionKind.EVENT, created, due))
    assertEquals(due + 3 * day, expiryFor(SuggestionKind.BILL, created, due))
    assertEquals(created + 7 * day, expiryFor(SuggestionKind.MONEY, created, null))
    assertEquals(created + 7 * day, expiryFor(SuggestionKind.MONEY, created, due))
    assertEquals(created + 7 * day, expiryFor(SuggestionKind.BILL, created, null))
    assertEquals(created + 7 * day, expiryFor(SuggestionKind.EVENT, created, null))
  }

  @Test fun onlyWaitingCanRun() {
    assertTrue(SuggestionState.WAITING.canRun())
    SuggestionState.entries.filter { it != SuggestionState.WAITING }.forEach { assertFalse(it.name, it.canRun()) }
  }
}
