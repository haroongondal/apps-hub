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
