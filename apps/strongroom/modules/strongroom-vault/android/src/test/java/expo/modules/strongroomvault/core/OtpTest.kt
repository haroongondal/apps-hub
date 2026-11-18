package expo.modules.strongroomvault.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Otp (DESIGN §15.1): the otpauth URI grammar and the RFC 6238 code vectors. */
class OtpTest {
  private class Vectors(text: String) {
    private val root = Json.parseToJsonElement(text).jsonObject
    val secrets = root["secrets"]!!.jsonObject.let { o -> mapOf("sha1" to o.str("sha1"), "sha256" to o.str("sha256"), "sha512" to o.str("sha512")) }
    val rfc6238 = root["rfc6238"]!!.jsonArray.map { it.jsonObject.let { o -> Triple(o.num("t"), o.str("sha1"), o.str("sha256") to o.str("sha512")) } }
    val sixDigit = root["sixDigit"]!!.jsonArray.map { it.jsonObject.let { o -> Quad(o.num("t"), o.str("digest"), o.str("code")) } }
    val periodEdges = root["periodEdges"]!!.jsonArray.map { it.jsonObject.let { o -> Triple(o.num("period").toInt(), o.num("t"), o.str("code")) } }

    private fun kotlinx.serialization.json.JsonObject.str(k: String) = this[k]!!.jsonPrimitive.content
    private fun kotlinx.serialization.json.JsonObject.num(k: String) = this[k]!!.jsonPrimitive.content.toLong()
  }

  private class Quad(val t: Long, val digest: String, val code: String)

  private val vectors = Vectors(
    javaClass.getResourceAsStream("/otp-vectors.json")!!.readBytes().decodeToString(),
  )

  private fun uri(secret: String, algorithm: String? = null, digits: Int? = null, period: Int? = null) =
    buildString {
      append("otpauth://totp/RFC:test@rfc-editor.org?secret=")
      append(secret)
      algorithm?.let { append("&algorithm=").append(it) }
      digits?.let { append("&digits=").append(it) }
      period?.let { append("&period=").append(it) }
    }

  @Test fun rfc6238EightDigitVectors() {
    for ((t, sha1, pair) in vectors.rfc6238) {
      val (sha256, sha512) = pair
      assertEquals("t=$t sha1", sha1, Otp.code(Otp.parse(uri(vectors.secrets["sha1"]!!, "SHA1", 8))!!, t))
      assertEquals("t=$t sha256", sha256, Otp.code(Otp.parse(uri(vectors.secrets["sha256"]!!, "SHA256", 8))!!, t))
      assertEquals("t=$t sha512", sha512, Otp.code(Otp.parse(uri(vectors.secrets["sha512"]!!, "SHA512", 8))!!, t))
    }
  }

  @Test fun sixDigitVectors() {
    for (row in vectors.sixDigit) {
      assertEquals("t=${row.t} ${row.digest}", row.code, Otp.code(Otp.parse(uri(vectors.secrets[row.digest]!!, row.digest.uppercase(), 6))!!, row.t))
    }
  }

  @Test fun periodEdges() {
    for ((period, t, code) in vectors.periodEdges) {
      assertEquals("t=$t period=$period", code, Otp.code(Otp.parse(uri(vectors.secrets["sha1"]!!, period = period))!!, t))
    }
  }

  @Test fun stringConvenienceParsesEachTime() {
    assertEquals("287082", Otp.code(uri(vectors.secrets["sha1"]!!), 59))
    assertNull(Otp.code("otpauth://hotp/x?secret=${vectors.secrets["sha1"]}&counter=0", 59))
  }

  @Test fun stateCountsDownAndNeverReadsZero() {
    val t = Otp.parse(uri(vectors.secrets["sha1"]!!))!!
    assertEquals(30, Otp.state(t, 0).secondsLeft)
    assertEquals(30, Otp.state(t, 60).secondsLeft)
    assertEquals(29, Otp.state(t, 61).secondsLeft)
    assertEquals(1, Otp.state(t, 89).secondsLeft)
    assertEquals(Otp.code(t, 60), Otp.state(t, 60).code)
    assertEquals(30, Otp.state(t, 60).period)
    val eight = Otp.parse(uri(vectors.secrets["sha1"]!!, digits = 8))!!
    assertEquals(8, Otp.state(eight, 45).code.length)
  }

  @Test fun defaultsAreSha1SixDigitsThirtySeconds() {
    val t = Otp.parse("otpauth://totp/alice@example.com?secret=${vectors.secrets["sha1"]}")!!
    assertEquals(Otp.Digest.SHA1, t.algorithm)
    assertEquals(6, t.digits)
    assertEquals(30, t.period)
    assertNull(t.issuer)
    assertEquals("alice@example.com", t.account)
    assertEquals("otpauth://totp/alice@example.com?secret=${vectors.secrets["sha1"]}", t.raw)
  }

  @Test fun issuerParameterBeatsTheLabelPrefix() {
    val t = Otp.parse("otpauth://totp/Wrong:bob?secret=${vectors.secrets["sha1"]}&issuer=Right")!!
    assertEquals("Right", t.issuer)
    assertEquals("bob", t.account)
  }

  @Test fun labelPrefixIsTheIssuerWithoutAParameter() {
    val t = Otp.parse("otpauth://totp/Example:alice@example.com?secret=${vectors.secrets["sha1"]}")!!
    assertEquals("Example", t.issuer)
    assertEquals("alice@example.com", t.account)
  }

  @Test fun labelIsPercentDecoded() {
    val t = Otp.parse("otpauth://totp/Ex%20ample:al%3Aice?secret=${vectors.secrets["sha1"]}")!!
    assertEquals("Ex ample", t.issuer)
    assertEquals("al:ice", t.account)
  }

  @Test fun schemeAndTypeAndBase32CaseDoNotMatter() {
    val t = Otp.parse("OTPAUTH://TOTP/a:b?SECRET=${vectors.secrets["sha1"]!!.lowercase()}&ALGORITHM=sha256&DIGITS=8&PERIOD=60")!!
    assertEquals(Otp.Digest.SHA256, t.algorithm)
    assertEquals(8, t.digits)
    assertEquals(60, t.period)
  }

  @Test fun paddedAndSpacedSecretsDecodeLikeThePlainOne() {
    val plain = Otp.parse("otpauth://totp/x?secret=${vectors.secrets["sha1"]}")!!.secret
    val padded = Otp.parse("otpauth://totp/x?secret=${vectors.secrets["sha1"]}=")!!.secret
    val spaced = Otp.parse("otpauth://totp/x?secret=${vectors.secrets["sha1"]!!.chunked(4).joinToString(" ")}")!!.secret
    assertTrue(plain.contentEquals(padded) && plain.contentEquals(spaced))
  }

  @Test fun unknownParametersAreIgnored() {
    val t = Otp.parse("otpauth://totp/x?secret=${vectors.secrets["sha1"]}&image=https://x/y.png&counter=3&foo=bar")!!
    assertEquals(6, t.digits)
    assertNull(t.issuer)
  }

  @Test fun firstOccurrenceWinsForDuplicateParameters() {
    assertEquals(8, Otp.parse("otpauth://totp/x?secret=${vectors.secrets["sha1"]}&digits=8&digits=6")!!.digits)
  }

  @Test fun refusalsNameTheProblem() {
    assertEquals("This QR is not an authenticator code", Otp.refusal("https://example.com/qr?secret=${vectors.secrets["sha1"]}"))
    assertEquals("This QR is not an authenticator code", Otp.refusal("not a uri at all"))
    assertEquals("Counter-based codes are not supported", Otp.refusal("otpauth://hotp/x?secret=${vectors.secrets["sha1"]}&counter=0"))
    assertEquals("The QR holds no secret key", Otp.refusal("otpauth://totp/x?issuer=y"))
    assertEquals("The QR's secret is not valid base32", Otp.refusal("otpauth://totp/x?secret=JBSWY1DP")) // '1' is not base32
    assertEquals("The secret is too short (needs at least 80 bits)", Otp.refusal("otpauth://totp/x?secret=JBSWY3DPEHPK3PX")) // 15 chars = 9 bytes
    assertEquals("The secret is too long (at most 512 bits)", Otp.refusal("otpauth://totp/x?secret=${vectors.secrets["sha512"]}${vectors.secrets["sha1"]}")) // 68 bytes
    assertEquals("The QR names an algorithm Strongroom doesn't know", Otp.refusal("otpauth://totp/x?secret=${vectors.secrets["sha1"]}&algorithm=SHA3"))
    assertEquals("Digits must be 6 or 8", Otp.refusal("otpauth://totp/x?secret=${vectors.secrets["sha1"]}&digits=7"))
    assertEquals("The QR's digit count is not a number", Otp.refusal("otpauth://totp/x?secret=${vectors.secrets["sha1"]}&digits=six"))
    assertEquals("The period must be 15–120 seconds", Otp.refusal("otpauth://totp/x?secret=${vectors.secrets["sha1"]}&period=14"))
    assertEquals("The QR's period is not a number", Otp.refusal("otpauth://totp/x?secret=${vectors.secrets["sha1"]}&period=abc"))
    assertEquals("This QR is malformed", Otp.refusal("otpauth://totp/x?secret=${vectors.secrets["sha1"]}&issuer=%zz"))
    assertNull(Otp.refusal("otpauth://totp/x?secret=${vectors.secrets["sha1"]}"))
    assertNull(Otp.parse("otpauth://hotp/x?secret=${vectors.secrets["sha1"]}&counter=0"))
  }

  @Test fun base32Boundaries() {
    assertNull(Otp.base32(""))
    assertNull(Otp.base32("JBSWY1DP")) // '1' is not in the alphabet
    assertEquals(5, Otp.base32("JBSWY3DP")!!.size) // 8 chars -> 5 bytes exactly
    assertEquals(6, Otp.base32("JBSWY3DPEH")!!.size) // 10 chars -> 6 bytes, 2 trailing bits discarded
    assertEquals(0xFF, Otp.base32("77")!![0].toInt() and 0xff) // two 11111 groups -> one 11111111 byte
  }
}
