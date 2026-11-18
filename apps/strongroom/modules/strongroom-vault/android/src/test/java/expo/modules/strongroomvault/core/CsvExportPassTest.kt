package expo.modules.strongroomvault.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class CsvExportPassTest {
  @Test fun aPassIsLeftOutOfTheExportAndItsCodeNeverAppears() {
    val pass = Entry.Pass("Gym", "SECRET-CODE-123", PassFormat.QR, "member", 5)
    val note = Entry.Note("Wi-Fi", "ssid", 5)
    val out = CsvExport.csv(listOf(pass, note))
    assertEquals(2, Csv.parse(out).size)
    assertFalse(out.contains("SECRET-CODE-123"))
    assertFalse(out.contains("Gym"))
  }
}
