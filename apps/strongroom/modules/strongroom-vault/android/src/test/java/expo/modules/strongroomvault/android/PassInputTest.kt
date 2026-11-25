package expo.modules.strongroomvault.android

import expo.modules.kotlin.exception.CodedException
import expo.modules.strongroomvault.core.Entry
import expo.modules.strongroomvault.core.MatchIndex
import expo.modules.strongroomvault.core.PassFormat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PassInputTest {
  private fun input(name: String = "Gym", code: String = "ABC-123", format: String = "code128", note: String = "") =
    mapOf("type" to "pass", "name" to name, "code" to code, "format" to format, "note" to note)

  @Test fun buildsAPassFromAValidInput() {
    val e = EntryInput.toEntry(input(note = "front desk"), null) as Entry.Pass
    assertEquals(Entry.Pass("Gym", "ABC-123", PassFormat.CODE128, "front desk", 0), e)
  }

  @Test fun anExpiryDateIsOptionalAndRefusedWhenItDoesNotRead() {
    assertEquals(null, (EntryInput.toEntry(input(), null) as Entry.Pass).expiresOn)
    assertEquals(null, (EntryInput.toEntry(input() + ("expiresOn" to "  "), null) as Entry.Pass).expiresOn)
    assertEquals(java.time.LocalDate.of(2027, 3, 31), (EntryInput.toEntry(input() + ("expiresOn" to " 2027-03-31 "), null) as Entry.Pass).expiresOn)
    for (bad in listOf("31/03/2027", "2027-02-30", "soon")) {
      assertEquals("Enter the expiry date as year-month-day, such as 2027-03-31.", assertThrows(CodedException::class.java) { EntryInput.toEntry(input() + ("expiresOn" to bad), null) }.message)
    }
  }

  @Test fun refusesABlankName() {
    assertEquals("Give the pass a name.", assertThrows(CodedException::class.java) { EntryInput.toEntry(input(name = "  "), null) }.message)
  }

  @Test fun refusesACodeTheFormatCannotDrawWithItsReason() {
    assertEquals("EAN-13 needs 12 or 13 digits", assertThrows(CodedException::class.java) { EntryInput.toEntry(input(code = "123", format = "ean13"), null) }.message)
    assertEquals("Enter the code first", assertThrows(CodedException::class.java) { EntryInput.toEntry(input(code = ""), null) }.message)
  }

  @Test fun refusesAnUnknownFormat() {
    assertThrows(IllegalArgumentException::class.java) { EntryInput.toEntry(input(format = "aztec"), null) }
  }

  @Test fun aPassNeverReachesTheAutofillIndex() {
    val pass = EntryInput.toEntry(input(), null)
    assertTrue(MatchIndex.build(mapOf("p1" to pass)).isEmpty())
  }
}
