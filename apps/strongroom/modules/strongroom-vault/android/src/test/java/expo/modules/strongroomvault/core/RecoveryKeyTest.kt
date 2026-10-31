package expo.modules.strongroomvault.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RecoveryKeyTest {
  @Test fun generateGives20RandomBytes() {
    val a = RecoveryKey.generate()
    assertEquals(20, a.size)
    assertTrue(!a.contentEquals(RecoveryKey.generate()))
  }

  @Test fun formatIsEightGroupsOfFour() {
    val formatted = RecoveryKey.format(RecoveryKey.generate())
    assertTrue(formatted, Regex("^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$").matches(formatted))
  }

  @Test fun formatMatchesRfc4648Vector() {
    // RFC 4648 section 10: BASE32("fooba") = "MZXW6YTB"; each 5-byte block encodes on its own.
    val formatted = RecoveryKey.format("foobafoobafoobafooba".toByteArray())
    assertEquals("RFC 4648 section 10", "MZXW-6YTB-MZXW-6YTB-MZXW-6YTB-MZXW-6YTB", formatted)
    assertEquals("AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA", RecoveryKey.format(ByteArray(20)))
    assertEquals("7777-7777-7777-7777-7777-7777-7777-7777", RecoveryKey.format(ByteArray(20) { -1 }))
  }

  @Test fun parseRoundTripsAndIsTolerant() {
    repeat(100) {
      val b = RecoveryKey.generate()
      val formatted = RecoveryKey.format(b)
      assertArrayEquals(b, RecoveryKey.parse(formatted))
      assertArrayEquals(b, RecoveryKey.parse(formatted.lowercase().replace("-", " ")))
      assertArrayEquals(b, RecoveryKey.parse("  " + formatted.replace("-", "").lowercase() + "\n"))
    }
  }

  @Test fun parseRejectsWrongLength() {
    val formatted = RecoveryKey.format(RecoveryKey.generate())
    assertNull(RecoveryKey.parse("ABCD-EFGH"))
    assertNull(RecoveryKey.parse(""))
    assertNull(RecoveryKey.parse(formatted + "A"))
    assertNull(RecoveryKey.parse(formatted.dropLast(1)))
  }

  @Test fun parseRejectsCharactersOutsideTheAlphabet() {
    val formatted = RecoveryKey.format(RecoveryKey.generate())
    for (bad in listOf('1', '8', '0', '9', '=', '!', '\u00df')) {
      assertNull("char $bad", RecoveryKey.parse(bad + formatted.drop(1)))
    }
    assertNull(RecoveryKey.parse("\u00df".repeat(16)))
  }

  @Test fun groupReturnsTheIndexedGroup() {
    val formatted = "ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567"
    assertEquals("ABCD", RecoveryKey.group(formatted, 0))
    assertEquals("MNOP", RecoveryKey.group(formatted, 3))
    assertEquals("4567", RecoveryKey.group(formatted, 7))
  }
}
