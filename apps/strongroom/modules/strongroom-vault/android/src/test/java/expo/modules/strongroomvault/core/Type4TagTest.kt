package expo.modules.strongroomvault.core

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import kotlin.random.Random
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class Type4TagTest {
  private fun hex(s: String) = s.replace(" ", "").fromHex()
  private val selectAid = hex("00 A4 04 00 07 D2 76 00 00 85 01 01 00")
  private val selectCc = hex("00 A4 00 0C 02 E1 03")
  private val selectNdef = hex("00 A4 00 0C 02 E1 04")
  private val update = hex("00 D6 00 00 02 00 00")
  private fun readBinary(offset: Int, le: Int) = byteArrayOf(0, 0xB0.toByte(), (offset ushr 8).toByte(), offset.toByte(), le.toByte())
  private val uriPrefixes = listOf("", "http://www.", "https://www.", "http://", "https://")

  private fun u16(b: ByteArray, at: Int) = ((b[at].toInt() and 0xFF) shl 8) or (b[at + 1].toInt() and 0xFF)

  private fun Type4Tag.ok(apdu: ByteArray, now: Long = 0): ByteArray {
    val r = process(apdu, now)
    assertEquals("SW for ${apdu.joinToString("") { "%02X".format(it) }}", 0x9000, u16(r, r.size - 2))
    return r.copyOf(r.size - 2)
  }

  private fun Type4Tag.sw(apdu: ByteArray, now: Long = 0): Int {
    val r = process(apdu, now)
    assertEquals("an error carries no data", 2, r.size)
    return u16(r, 0)
  }

  private fun armed(code: String, now: Long = 0) = Type4Tag().apply { arm(Ndef.forCode(code), now) }

  /** The full NFC Forum reader sequence, taking MLe and the NDEF file id from the CC as a real reader does. */
  private fun readAsReader(tag: Type4Tag, now: Long = 0): String {
    tag.ok(selectAid, now)
    tag.ok(selectCc, now)
    val cc = tag.ok(readBinary(0, 15), now)
    val mle = u16(cc, 3)
    assertEquals(0x04, cc[7].toInt())
    assertEquals(0x00, cc[13].toInt())
    tag.ok(byteArrayOf(0, 0xA4.toByte(), 0, 0x0C, 2, cc[9], cc[10]), now)
    val nlen = u16(tag.ok(readBinary(0, 2), now), 0)
    val msg = ByteArrayOutputStream()
    while (msg.size() < nlen) {
      val chunk = tag.ok(readBinary(2 + msg.size(), minOf(mle, nlen - msg.size())), now)
      assertTrue(chunk.isNotEmpty() && chunk.size <= mle)
      msg.write(chunk)
    }
    return decode(msg.toByteArray())
  }

  private fun decode(m: ByteArray): String {
    val h = m[0].toInt() and 0xFF
    assertEquals("MB, ME, well-known", 0xC1, h and 0xC7)
    assertEquals(1, m[1].toInt())
    val short = h and 0x10 != 0
    val len = if (short) m[2].toInt() and 0xFF else ByteBuffer.wrap(m, 2, 4).int
    val typeAt = if (short) 3 else 6
    assertEquals(m.size, typeAt + 1 + len)
    val p = m.copyOfRange(typeAt + 1, m.size)
    return when (m[typeAt].toInt().toChar()) {
      'U' -> uriPrefixes[p[0].toInt()] + String(p, 1, p.size - 1, Charsets.UTF_8)
      'T' -> {
        assertEquals("UTF-8", 0, p[0].toInt() and 0x80)
        val lang = p[0].toInt() and 0x3F
        assertEquals("en", String(p, 1, lang, Charsets.US_ASCII))
        String(p, 1 + lang, p.size - 1 - lang, Charsets.UTF_8)
      }
      else -> throw AssertionError("unexpected record type")
    }
  }

  @Test fun capabilityContainerIsTheV2ReadOnlyVector() {
    val tag = armed("x")
    tag.ok(selectAid)
    tag.ok(selectCc)
    assertArrayEquals(hex("000F 20 003B 0034 04 06 E104 0802 00 FF"), tag.ok(readBinary(0, 0)))
  }

  @Test fun readerGetsTheLinkBack() {
    for (code in listOf("https://www.example.com/member/42", "http://gym.example/x?id=7", "HTTPS://Example.com/Card")) {
      assertEquals(code, readAsReader(armed(code)))
    }
  }

  @Test fun readerGetsNonAsciiTextBack() {
    val code = "Gym Ünï 会员 ✓ کارڈ 0042"
    assertEquals(code, readAsReader(armed(code)))
  }

  @Test fun messagesLargerThanOneReadComeBackWhole() {
    val m255 = "b".repeat(248)
    assertEquals(255, Ndef.forCode(m255).size)
    assertEquals(m255, readAsReader(armed(m255)))
    val max = "c".repeat(2038)
    assertEquals(Type4Tag.MAX_MESSAGE, Ndef.forCode(max).size)
    assertEquals(max, readAsReader(armed(max)))
  }

  @Test fun selectWithoutLeAndV1StyleFileSelectAlsoWork() {
    val tag = armed("x")
    tag.ok(selectAid.copyOf(12))
    tag.ok(hex("00 A4 00 00 02 E1 04"))
    assertEquals(Ndef.forCode("x").size, u16(tag.ok(readBinary(0, 2)), 0))
  }

  @Test fun overLimitOrEmptyArmIsRefusedAndLeavesNothingArmed() {
    val tag = armed("previous")
    assertThrows(IllegalArgumentException::class.java) { tag.arm(ByteArray(Type4Tag.MAX_MESSAGE + 1), 0) }
    assertNull(tag.heldForTest())
    assertEquals(0x6A82, tag.sw(selectAid))
    assertThrows(IllegalArgumentException::class.java) { tag.arm(ByteArray(0), 0) }
    assertThrows(IllegalArgumentException::class.java) { tag.arm(Ndef.forCode("x"), 0, 0) }
  }

  @Test fun wrongAidIsNotFoundAndSelectsNothing() {
    val tag = armed("x")
    assertEquals(0x6A82, tag.sw(hex("00 A4 04 00 07 D2 76 00 00 85 01 00 00")))
    assertEquals(0x6A82, tag.sw(selectCc))
    assertEquals(0x6A82, tag.sw(hex("00 A4 04 00 08 D2 76 00 00 85 01 01 00")))
    assertEquals(0x6A82, tag.sw(hex("00 A4 04 00 06 D2 76 00 00 85 01")))
    tag.ok(selectAid)
    assertEquals("a failed AID select drops the earlier one", 0x6A82, tag.sw(hex("00 A4 04 00 07 A0 00 00 00 03 10 10")))
    assertEquals(0x6A82, tag.sw(selectNdef))
  }

  @Test fun filesNeedTheAppAndAKnownId() {
    val tag = armed("x")
    assertEquals(0x6A82, tag.sw(selectCc))
    tag.ok(selectAid)
    assertEquals(0x6A82, tag.sw(hex("00 A4 00 0C 02 E1 05")))
    assertEquals(0x6986, tag.sw(readBinary(0, 2)))
    assertEquals(0x6A82, tag.sw(hex("00 A4 02 0C 02 E1 04")))
  }

  @Test fun unarmedRevealsNothing() {
    val tag = Type4Tag()
    assertEquals(0x6A82, tag.sw(selectAid))
    assertEquals(0x6A82, tag.sw(selectCc))
    assertEquals(0x6D00, tag.sw(readBinary(0, 15)))
    assertEquals(0x6D00, tag.sw(update))
    assertEquals(0x6D00, tag.sw(hex("00 CA 00 00 00")))
  }

  @Test fun expiresAtExactlyTheTtl() {
    val tag = Type4Tag()
    tag.arm(Ndef.forCode("code-1"), 1_000, 60_000)
    val held = tag.heldForTest()!!
    assertEquals("code-1", readAsReader(tag, 60_999))
    assertEquals(0x6A82, tag.sw(selectAid, 61_000))
    assertNull(tag.heldForTest())
    assertTrue(held.all { it == 0.toByte() })
    assertEquals(0x6A82, tag.sw(selectAid, 1_000))
  }

  @Test fun expiryMidSessionCutsTheReaderOff() {
    val tag = Type4Tag()
    tag.arm(Ndef.forCode("code-1"), 0, 100)
    tag.ok(selectAid, 50)
    tag.ok(selectNdef, 50)
    assertEquals(0x6D00, tag.sw(readBinary(0, 2), 100))
  }

  @Test fun clockBeforeArmingCountsAsExpired() {
    val tag = Type4Tag()
    tag.arm(Ndef.forCode("x"), 5_000)
    assertEquals(0x6A82, tag.sw(selectAid, 4_999))
    assertNull(tag.heldForTest())
  }

  @Test fun disarmWipesTheBuffer() {
    val tag = armed("secret-member-code")
    val held = tag.heldForTest()!!
    tag.ok(selectAid)
    tag.ok(selectNdef)
    tag.disarm()
    assertTrue(held.all { it == 0.toByte() })
    assertNull(tag.heldForTest())
    assertEquals(0x6D00, tag.sw(readBinary(0, 2)))
    assertEquals(0x6A82, tag.sw(selectAid))
  }

  @Test fun readsPastTheEndAreRefusedOrCut() {
    val tag = armed("x")
    val size = tag.heldForTest()!!.size
    tag.ok(selectAid)
    tag.ok(selectNdef)
    assertEquals(0x6B00, tag.sw(readBinary(size, 1)))
    assertEquals(0x6B00, tag.sw(readBinary(0xFFFF, 1)))
    assertEquals(0x6B00, tag.sw(readBinary(0x8000, 1)))
    assertEquals(1, tag.ok(readBinary(size - 1, 0x3B)).size)
    assertEquals(size, tag.ok(readBinary(0, 0)).size)
    tag.ok(selectCc)
    assertEquals(0x6B00, tag.sw(readBinary(15, 1)))
    val big = armed("d".repeat(500))
    big.ok(selectAid)
    big.ok(selectNdef)
    assertEquals("Le 00 is capped at MLe", Type4Tag.MLE, big.ok(readBinary(0, 0)).size)
  }

  @Test fun writesAreRefused() {
    val tag = armed("keep-me")
    tag.ok(selectAid)
    tag.ok(selectNdef)
    assertEquals(0x6982, tag.sw(update))
    tag.ok(selectCc)
    assertEquals(0x6982, tag.sw(update))
    assertEquals("keep-me", readAsReader(tag))
  }

  @Test fun malformedApdusGetAStatusNotAnException() {
    val tag = armed("x")
    assertEquals(0x6700, tag.sw(ByteArray(0)))
    assertEquals(0x6700, tag.sw(hex("00 A4")))
    assertEquals(0x6700, tag.sw(hex("00 A4 04 00")))
    assertEquals(0x6700, tag.sw(hex("00 A4 04 00 07 D2")))
    assertEquals(0x6E00, tag.sw(hex("80 A4 04 00 07 D2 76 00 00 85 01 01 00")))
    tag.ok(selectAid)
    tag.ok(selectNdef)
    assertEquals(0x6700, tag.sw(hex("00 B0 00 00")))
    assertEquals(0x6700, tag.sw(hex("00 B0 00 00 00 00 3B")))
    val rnd = Random(7)
    repeat(20_000) {
      val apdu = rnd.nextBytes(rnd.nextInt(0, 20))
      if (rnd.nextInt(3) == 0 && apdu.size > 1) { apdu[0] = 0; apdu[1] = listOf(0xA4, 0xB0, 0xD6).random(rnd).toByte() }
      val r = tag.process(apdu, 0)
      assertTrue(r.size in 2..Type4Tag.MLE + 2)
    }
    assertEquals("x", readAsReader(tag))
  }
}
