package expo.modules.strongroomvault.core

import java.time.LocalDate
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ExpiryIndexTest {
  private val visa = Entry.Card("Visa travel", "A. Holder", "4111111111119876", 2, 2027, "321", "pin 4455", 1)
  private val amex = Entry.Card("  ", "B. Holder", "378282246310005", 11, 26, "9911", "", 2)
  private val undated = Entry.Card("Store card", "C. Holder", "6011000990139424", null, null, "", "", 3)
  private val bad = Entry.Card("Bad", "D. Holder", "5555", 13, 2030, "", "", 4)
  private val login = Entry.Login("Bank", "me@bank.com", "hunter2-unique", listOf(Site(true, "bank.com")), emptyList(), "", 5)
  private val pass = Entry.Pass("Gym", "GYM-0001", PassFormat.QR, "", 6)
  private val entries = mapOf("v" to visa, "a" to amex, "u" to undated, "b" to bad, "l" to login, "p" to pass, "d" to Entry.Deleted(7))

  @Test fun datesOnlyGivesGenericLabelsSortedByDate() {
    assertEquals(
      listOf(ExpiryItem("card", "Card", LocalDate.of(2026, 11, 30)), ExpiryItem("card", "Card", LocalDate.of(2027, 2, 28))),
      ExpiryIndex.build(entries, showNames = false),
    )
  }

  @Test fun aPassWithADateGivesARowAndOneWithoutGivesNone() {
    val dated = Entry.Pass("Gym", "GYM-0001", PassFormat.QR, "desk 4", 8, LocalDate.of(2026, 12, 15))
    val all = entries + ("g" to dated)
    assertEquals(
      listOf(ExpiryItem("card", "Card", LocalDate.of(2026, 11, 30)), ExpiryItem("pass", "Pass", LocalDate.of(2026, 12, 15)), ExpiryItem("card", "Card", LocalDate.of(2027, 2, 28))),
      ExpiryIndex.build(all, showNames = false),
    )
    assertEquals(listOf("Card", "Gym", "Visa travel"), ExpiryIndex.build(all, showNames = true).map { it.label })
    assertEquals("Pass", ExpiryIndex.build(mapOf("g" to dated.copy(name = "  ")), showNames = true).single().label)
    val text = String(ExpiryIndex.encode(ExpiryIndex.build(all, showNames = false)), Charsets.UTF_8)
    for (secret in listOf("GYM-0001", "Gym", "desk 4")) assertFalse(secret, text.contains(secret))
  }

  @Test fun showNamesUsesTheCardNameOrCardWhenBlank() {
    assertEquals(listOf("Card", "Visa travel"), ExpiryIndex.build(entries, showNames = true).map { it.label })
    val long = Entry.Card("x".repeat(200), "", "", 1, 2030, "", "", 1)
    assertEquals(ExpiryIndex.MAX_LABEL, ExpiryIndex.build(mapOf("c" to long), true).single().label.length)
  }

  @Test fun theIndexHoldsNoSecretsNumbersHoldersOrNotes() {
    for (names in listOf(false, true)) {
      val text = String(ExpiryIndex.encode(ExpiryIndex.build(entries, names)), Charsets.UTF_8)
      for (secret in listOf("4111", "9876", "3782", "0005", "321", "9911", "Holder", "pin 4455", "hunter2", "me@bank", "GYM-0001", "Gym", "Store card")) {
        assertFalse("$secret with names=$names", text.contains(secret))
      }
      if (!names) assertFalse(text.contains("Visa"))
    }
  }

  @Test fun endOfMonthTakesTwoOrFourDigitYearsAndRefusesNonsense() {
    assertEquals(LocalDate.of(2028, 2, 29), ExpiryIndex.endOfMonth(2, 2028))
    assertEquals(LocalDate.of(2031, 12, 31), ExpiryIndex.endOfMonth(12, 31))
    assertEquals(null, ExpiryIndex.endOfMonth(0, 2030))
    assertEquals(null, ExpiryIndex.endOfMonth(5, 1999))
    assertEquals(null, ExpiryIndex.endOfMonth(null, 2030))
  }

  @Test fun encodeDecodeRoundTripsAndGarbageIsEmpty() {
    val items = ExpiryIndex.build(entries, true)
    assertEquals(items, ExpiryIndex.decode(ExpiryIndex.encode(items)))
    assertEquals(emptyList<ExpiryItem>(), ExpiryIndex.decode(null))
    assertEquals(emptyList<ExpiryItem>(), ExpiryIndex.decode("not json".toByteArray()))
    assertEquals(emptyList<ExpiryItem>(), ExpiryIndex.decode("""[{"kind":"card","label":"x","expiresOn":"soon"}]""".toByteArray()))
  }

  @Test fun aRowCountsDaysLeftFromToday() {
    val item = ExpiryItem("card", "Card", LocalDate.of(2026, 12, 31))
    assertArrayEquals(arrayOf<Any>("card", "Card", "2026-12-31", 38L), ExpiryIndex.row(item, LocalDate.of(2026, 11, 23)))
    assertEquals(-1L, ExpiryIndex.row(item, LocalDate.of(2027, 1, 1))[3])
  }
}
