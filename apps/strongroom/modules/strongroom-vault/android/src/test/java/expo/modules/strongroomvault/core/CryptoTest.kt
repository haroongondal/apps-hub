package expo.modules.strongroomvault.core

import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class CryptoTest {
  @Before fun lowerKdfFloor() {
    KdfParams.testFloor = KdfParams(1024, 1, 1)
  }

  @After fun clearKdfFloor() {
    KdfParams.testFloor = null
  }

  private fun hex(s: String): ByteArray =
    s.filterNot { it.isWhitespace() }.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

  private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

  private val key = ByteArray(32) { it.toByte() }
  private val aad = "record-id|1".toByteArray()

  // The RFC 9106 vector uses a secret and associated data, which Crypto.argon2id doesn't take: drive BouncyCastle directly.
  @Test fun argon2idMatchesRfc9106Vector() {
    val params = Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
      .withVersion(Argon2Parameters.ARGON2_VERSION_13)
      .withMemoryAsKB(32)
      .withIterations(3)
      .withParallelism(4)
      .withSalt(ByteArray(16) { 0x02 })
      .withSecret(ByteArray(8) { 0x03 })
      .withAdditional(ByteArray(12) { 0x04 })
      .build()
    val out = ByteArray(32)
    Argon2BytesGenerator().apply { init(params) }.generateBytes(ByteArray(32) { 0x01 }, out)
    assertEquals(
      "RFC 9106 section 5.3 (Argon2id test vector), tag",
      "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659",
      out.toHex(),
    )
  }

  @Test fun argon2idWrapperMatchesReferenceVectors() {
    val salt = "somesalt".toByteArray()
    assertEquals(
      "phc-winner-argon2 src/test.c hashtest(0x13, t=2, m=2^8 KiB, p=1, password, somesalt)",
      "9dfeb910e80bad0311fee20f9c0e2b12c17987b4cac90c2ef54d5b3021c68bfe",
      Crypto.argon2id("password".toCharArray(), salt, KdfParams(256, 2, 1)).toHex(),
    )
    assertEquals(
      "phc-winner-argon2 src/test.c hashtest(0x13, t=2, m=2^8 KiB, p=2, password, somesalt)",
      "6d093c501fd5999645e0ea3bf620d7b8be7fd2db59c20d9fff9539da2bf57037",
      Crypto.argon2id("password".toCharArray(), salt, KdfParams(256, 2, 2)).toHex(),
    )
  }

  @Test fun hkdfMatchesRfc5869Case1() {
    val okm = Crypto.hkdf(
      ikm = hex("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"),
      salt = hex("000102030405060708090a0b0c"),
      info = hex("f0f1f2f3f4f5f6f7f8f9"),
      length = 42,
    )
    assertEquals(
      "RFC 5869 Appendix A.1 (Test Case 1, SHA-256 with salt), OKM",
      "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
      okm.toHex(),
    )
  }

  @Test fun hkdfWithoutSaltMatchesRfc5869Case3() {
    val okm = Crypto.hkdf(hex("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"), "", 42)
    assertEquals(
      "RFC 5869 Appendix A.3 (Test Case 3, zero-length salt and info), OKM",
      "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8",
      okm.toHex(),
    )
  }

  @Test fun hkdfLabelsGiveDistinctKeys() {
    val wrap = Crypto.hkdf(key, "strongroom/v1/wrap")
    val login = Crypto.hkdf(key, "strongroom/v1/login")
    assertEquals(32, wrap.size)
    assertFalse(wrap.contentEquals(login))
  }

  @Test fun aesGcmMatchesNistVector() {
    val k = hex("feffe9928665731c6d6a8f9467308308 feffe9928665731c6d6a8f9467308308")
    val p = hex(
      "d9313225f88406e5a55909c5aff5269a 86a7a9531534f7da2e4c303d8a318a72 " +
        "1c3c0c95956809532fcf0e2449a6b525 b16aedf5aa0de657ba637b39",
    )
    val a = hex("feedfacedeadbeeffeedfacedeadbeef abaddad2")
    val iv = hex("cafebabefacedbaddecaf888")
    val c = hex(
      "522dc1f099567d07f47f37a32a84427d 643a8cdcbfe5c0c97598a2bd2555d1aa " +
        "8cb08e48590dbb3da7b08b1056828838 c5f61e6393ba7a0abcc9f662",
    )
    val t = hex("76fc6ece0f4e1768cddf8853bb2d551b")
    val opened = Crypto.open(k, iv + c + t, a)
    assertArrayEquals("McGrew and Viega GCM spec, Test Case 16 (AES-256, 96-bit IV, AAD)", p, opened)
  }

  @Test fun kdfFloorAndCeiling() {
    KdfParams.testFloor = null
    assertTrue(KdfParams(32768, 2, 1).inRange())
    assertTrue(KdfParams.DEFAULT.inRange())
    assertTrue(KdfParams(1048576, 2, 1).inRange())
    assertFalse(KdfParams(32767, 2, 1).inRange())
    assertFalse(KdfParams(32768, 1, 1).inRange())
    assertFalse(KdfParams(32768, 2, 0).inRange())
    assertFalse(KdfParams(1048577, 2, 1).inRange())
    assertTrue(KdfParams(32768, 16, 1).inRange())
    assertTrue(KdfParams(32768, 2, 4).inRange())
    assertFalse(KdfParams(32768, 17, 1).inRange())
    assertFalse(KdfParams(32768, 2, 5).inRange())
    assertFalse(KdfParams(32768, 2, 1_000_000).inRange())
    assertFalse(KdfParams(32768, Int.MAX_VALUE, 1).inRange())
  }

  @Test fun testFloorReplacesTheFloorButNotTheCeiling() {
    assertTrue(KdfParams(1024, 1, 1).inRange())
    assertFalse(KdfParams(1023, 1, 1).inRange())
    assertFalse(KdfParams(1048577, 1, 1).inRange())
  }

  @Test fun sealOpenRoundTrip() {
    val plaintext = "correct horse battery staple".toByteArray()
    assertArrayEquals(plaintext, Crypto.open(key, Crypto.seal(key, plaintext, aad), aad))
  }

  @Test fun sealUsesAFreshNonceAndAddsNonceAndTag() {
    val plaintext = ByteArray(5)
    val a = Crypto.seal(key, plaintext, aad)
    val b = Crypto.seal(key, plaintext, aad)
    assertEquals(12 + plaintext.size + 16, a.size)
    assertFalse(a.copyOfRange(0, 12).contentEquals(b.copyOfRange(0, 12)))
  }

  @Test fun openRejectsTamperedByte() {
    val sealed = Crypto.seal(key, "secret".toByteArray(), aad)
    for (i in sealed.indices) {
      val tampered = sealed.copyOf().also { it[i] = (it[i].toInt() xor 1).toByte() }
      assertNull("byte $i", Crypto.open(key, tampered, aad))
    }
  }

  @Test fun openRejectsWrongAad() {
    val sealed = Crypto.seal(key, "secret".toByteArray(), aad)
    assertNull(Crypto.open(key, sealed, "record-id|2".toByteArray()))
  }

  @Test fun openRejectsWrongKey() {
    val sealed = Crypto.seal(key, "secret".toByteArray(), aad)
    assertNull(Crypto.open(ByteArray(32) { 7 }, sealed, aad))
  }

  @Test fun openRejectsShortInput() {
    assertNull(Crypto.open(key, ByteArray(10), aad))
    assertNull(Crypto.open(key, ByteArray(0), aad))
    assertNull(Crypto.open(key, ByteArray(27), aad))
  }

  @Test fun openAcceptsEmptyPlaintext() {
    assertArrayEquals(ByteArray(0), Crypto.open(key, Crypto.seal(key, ByteArray(0), aad), aad))
  }

  @Test fun randomBytesHasTheRequestedLengthAndVaries() {
    assertEquals(32, Crypto.randomBytes(32).size)
    assertFalse(Crypto.randomBytes(32).contentEquals(Crypto.randomBytes(32)))
  }

  // Written as escapes, so an editor can't normalise them: NFC is U+00F6, NFD is "o" + U+0308.
  @Test fun nfcAndNfdPasswordsDeriveSameKey() {
    val nfc = "passw\u00f6rd"
    val nfd = "passwo\u0308rd"
    assertNotEquals(nfc, nfd)
    val salt = ByteArray(16) { 9 }
    val params = KdfParams(1024, 1, 1)
    val fromNfc = Crypto.argon2id(nfc.toCharArray(), salt, params)
    assertEquals(32, fromNfc.size)
    assertArrayEquals(fromNfc, Crypto.argon2id(nfd.toCharArray(), salt, params))
    assertFalse(fromNfc.contentEquals(Crypto.argon2id("password".toCharArray(), salt, params)))
  }

  @Test fun passwordBytesIsNfcThenUtf8() {
    assertEquals("7061737377c3b67264", Crypto.passwordBytes("passwo\u0308rd".toCharArray()).toHex())
  }

  @Test fun passwordBytesReplacesUnpairedSurrogatesLikeTextEncoder() {
    assertEquals("61efbfbd62", Crypto.passwordBytes("a\uD800b".toCharArray()).toHex())
    assertEquals("61efbfbd62", Crypto.passwordBytes("a\uDC00b".toCharArray()).toHex())
    assertEquals("61efbfbd", Crypto.passwordBytes("a\uD800".toCharArray()).toHex())
    assertEquals("efbfbdefbfbd", Crypto.passwordBytes("\uD800\uD800".toCharArray()).toHex())
    assertEquals("f09f9880", Crypto.passwordBytes("\uD83D\uDE00".toCharArray()).toHex())
  }
}
