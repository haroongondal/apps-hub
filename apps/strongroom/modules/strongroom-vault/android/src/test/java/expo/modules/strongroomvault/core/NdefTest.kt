package expo.modules.strongroomvault.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class NdefTest {
  private fun hex(s: String) = s.replace(" ", "").fromHex()

  @Test fun httpsWwwLinkIsAShortUriRecordWithPrefixCode02() {
    assertArrayEquals(hex("D1 01 0C 55 02") + "example.com".toByteArray(), Ndef.forCode("https://www.example.com"))
  }

  @Test fun everyPrefixInTheTableIsUsed() {
    for ((uri, id) in listOf("http://www.a.b/c" to 0x01, "https://www.a.b/c" to 0x02, "http://a.b/c" to 0x03, "https://a.b/c" to 0x04)) {
      val m = Ndef.forCode(uri)
      assertEquals(0xD1.toByte(), m[0])
      assertEquals((m.size - 4).toByte(), m[2])
      assertEquals('U'.code.toByte(), m[3])
      assertEquals(uri, id.toByte(), m[4])
      assertEquals("a.b/c", String(m, 5, m.size - 5))
    }
  }

  @Test fun upperCaseSchemeIsStillALinkButKeepsItsOwnBytes() {
    assertArrayEquals(hex("D1 01 14 55 00") + "HTTPS://Example.com".toByteArray(), Ndef.forCode("HTTPS://Example.com"))
    assertEquals('U'.code.toByte(), Ndef.forCode("Http://x")[3])
  }

  @Test fun plainCodesAndOtherSchemesAreEnglishUtf8Text() {
    assertArrayEquals(hex("D1 01 0D 54 02 65 6E 31 32 33 34 35 36 37 38 39 30"), Ndef.forCode("1234567890"))
    assertEquals('T'.code.toByte(), Ndef.forCode("ftp://example.com")[3])
    assertEquals('T'.code.toByte(), Ndef.forCode("httpx://example.com")[3])
  }

  @Test fun nonAsciiTextIsEncodedAsUtf8() {
    val code = "Gym Ünï 会员 ✓ کارڈ"
    val utf8 = code.toByteArray(Charsets.UTF_8)
    val m = Ndef.forCode(code)
    assertEquals(0x02.toByte(), m[4])
    assertEquals(3 + utf8.size, m[2].toInt() and 0xFF)
    assertEquals(code, String(m, 7, m.size - 7, Charsets.UTF_8))
  }

  @Test fun payloadOver255BytesUsesANormalRecordWithA4ByteLength() {
    val short = Ndef.text("a".repeat(252))
    assertEquals(0xD1.toByte(), short[0])
    assertEquals(0xFF.toByte(), short[2])
    val long = Ndef.text("a".repeat(253))
    assertArrayEquals(hex("C1 01 00 00 01 00 54 02 65 6E"), long.copyOf(10))
    assertEquals(7 + 256, long.size)
  }
}
