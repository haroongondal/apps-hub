package expo.modules.strongroomvault.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.text.Normalizer
import java.util.Base64

class VaultFormatTest {
  private val fast = KdfParams(1024, 1, 1)
  private val password = "correct horse battery staple".toCharArray()
  private val recoveryKey = ByteArray(20) { (it + 1).toByte() }
  private val login = Entry.Login("Example", "me", "secret", listOf(Site(true, "example.com")), emptyList(), "", 1)

  @Before fun lowerKdfFloor() {
    KdfParams.testFloor = fast
  }

  @After fun clearKdfFloor() {
    KdfParams.testFloor = null
  }

  private fun newVault() = VaultFormat.create(password, recoveryKey, fast)

  @Test fun createThenUnlockWithPasswordReturnsSameVaultKey() {
    val (header, vaultKey) = newVault()
    assertEquals(32, vaultKey.size)
    assertEquals(VaultFormat.VERSION, header.version)
    assertEquals(fast, header.kdf)
    assertEquals(16, header.salt.size)
    assertArrayEquals(vaultKey, VaultFormat.unlockWithPassword(header, password))
    assertArrayEquals(vaultKey, VaultFormat.unlockWithPassword(header, "correct horse battery staple".toCharArray()))
  }

  @Test fun wrongPasswordReturnsNull() {
    val (header, _) = newVault()
    assertNull(VaultFormat.unlockWithPassword(header, "correct horse battery stapl".toCharArray()))
    assertNull(VaultFormat.unlockWithPassword(header, CharArray(0)))
  }

  @Test fun recoveryKeyUnlocksAndNewPasswordWorksAfterwards() {
    val (header, vaultKey) = newVault()
    val viaRecovery = VaultFormat.unlockWithRecovery(header, recoveryKey)
    assertArrayEquals(vaultKey, viaRecovery)
    val newPassword = "an entirely new password".toCharArray()
    val rewrapped = VaultFormat.withNewPassword(header, viaRecovery!!, newPassword)
    assertNull(VaultFormat.unlockWithPassword(rewrapped, password))
    assertArrayEquals(vaultKey, VaultFormat.unlockWithPassword(rewrapped, newPassword))
    assertArrayEquals(vaultKey, VaultFormat.unlockWithRecovery(rewrapped, recoveryKey))
    assertFalse("a new salt is drawn", header.salt.contentEquals(rewrapped.salt))
    assertArrayEquals("recoveryWrap is kept", header.recoveryWrap, rewrapped.recoveryWrap)
  }

  @Test fun newRecoveryKeyRevokesOldOne() {
    val (header, vaultKey) = newVault()
    val newKey = ByteArray(20) { (it + 100).toByte() }
    val rewrapped = VaultFormat.withNewRecovery(header, vaultKey, newKey)
    assertNull(VaultFormat.unlockWithRecovery(rewrapped, recoveryKey))
    assertArrayEquals(vaultKey, VaultFormat.unlockWithRecovery(rewrapped, newKey))
    assertArrayEquals(vaultKey, VaultFormat.unlockWithPassword(rewrapped, password))
    assertArrayEquals(header.passwordWrap, rewrapped.passwordWrap)
  }

  @Test fun recordMovedToAnotherIdFailsToOpen() {
    val (_, vaultKey) = newVault()
    val sealed = VaultFormat.sealEntry(vaultKey, "a", login)
    assertEquals(login, VaultFormat.openEntry(vaultKey, "a", sealed))
    assertNull(VaultFormat.openEntry(vaultKey, "b", sealed))
    assertNull(VaultFormat.openEntry(ByteArray(32), "a", sealed))
    assertNotEquals(sealed.toList(), VaultFormat.sealEntry(vaultKey, "a", login).toList())
  }

  @Test fun entryStringsAreSealedAsTextEncoderWouldEncodeThem() {
    val (_, vaultKey) = newVault()
    val lone = 0xD800.toChar()
    val replacement = 0xFFFD.toChar()
    val sealed = VaultFormat.sealEntry(vaultKey, "a", Entry.Note("n", "a${lone}b", 1))
    assertEquals(Entry.Note("n", "a${replacement}b", 1), VaultFormat.openEntry(vaultKey, "a", sealed))
    val decomposed = "o" + 0x308.toChar()
    assertEquals(Entry.Note("n", decomposed, 1), VaultFormat.openEntry(vaultKey, "a", VaultFormat.sealEntry(vaultKey, "a", Entry.Note("n", decomposed, 1))))
  }

  @Test fun headerJsonRoundTrips() {
    val (header, _) = newVault()
    val json = header.toJson()
    assertEquals(header, Header.fromJson(json))
    assertEquals(json, Header.fromJson(json)!!.toJson())
    val o = Json.parseToJsonElement(json).jsonObject
    assertEquals(setOf("version", "kdf", "salt", "passwordWrap", "recoveryWrap"), o.keys)
    assertEquals(setOf("memoryKiB", "iterations", "parallelism"), o["kdf"]!!.jsonObject.keys)
    assertArrayEquals(header.salt, Base64.getDecoder().decode(o["salt"]!!.jsonPrimitive.content))
  }

  @Test fun headerFromJsonRefusesMalformedInput() {
    val (header, _) = newVault()
    val good = Json.parseToJsonElement(header.toJson()).jsonObject
    fun with(key: String, value: String) = JsonObject(good + (key to Json.parseToJsonElement(value))).toString()
    val bad = listOf(
      "",
      "not json",
      "[]",
      "{}",
      JsonObject(good - "salt").toString(),
      JsonObject(good - "kdf").toString(),
      with("version", "2"),
      with("version", "\"1\""),
      with("kdf", "{\"memoryKiB\":1024,\"iterations\":1}"),
      with("kdf", "{\"memoryKiB\":\"1024\",\"iterations\":1,\"parallelism\":1}"),
      with("kdf", "{\"memoryKiB\":1.5,\"iterations\":1,\"parallelism\":1}"),
      with("salt", "\"not base64!\""),
      with("salt", "\"AAAA\""),
      with("salt", "5"),
      with("passwordWrap", "\"***\""),
      with("recoveryWrap", "null"),
      """{"version":1,"kdf":""" + "[".repeat(2000) + "]".repeat(2000) + "}",
      """{"version":1,"kdf":""" + "[".repeat(100_000) + "]".repeat(100_000) + "}",
      header.toJson() + " ".repeat(5000),
    )
    for (s in bad) assertNull(s, Header.fromJson(s))
  }

  @Test fun headerFromJsonSurvivesStackOverflowOnADeepArrayUnderTheLengthCap() {
    val json = """{"version":1,"kdf":""" + "[".repeat(2000) + "]".repeat(2000) + "}"
    var parsed: Header? = Header(1, fast, ByteArray(16), ByteArray(0), ByteArray(0))
    var thrown: Throwable? = null
    val worker = Thread(null, { try { parsed = Header.fromJson(json) } catch (e: Throwable) { thrown = e } }, "small-stack", 128 * 1024)
    worker.start()
    worker.join()
    assertNull(thrown?.toString(), thrown)
    assertNull(parsed)
  }

  @Test(timeout = 5000)
  fun belowFloorHeaderRefusedBeforeDerivation() {
    val (header, _) = newVault()
    KdfParams.testFloor = null
    val refused = listOf(
      KdfParams(16, 1, 1),
      KdfParams(Int.MAX_VALUE, 1, 1),
      KdfParams(32768, Int.MAX_VALUE, 1),
      KdfParams(32768, 2, 1_000_000),
      KdfParams(1024, 1, 1),
      KdfParams(32768, 2, 0),
      KdfParams(32768, 17, 1),
      KdfParams(32768, 2, 5),
    )
    for (kdf in refused) {
      val e = assertThrows(kdf.toString(), KdfOutOfRange::class.java) {
        VaultFormat.unlockWithPassword(header.copy(kdf = kdf), password)
      }
      assertEquals(kdf, e.kdf)
    }
  }

  @Test fun paramsNeverDecrease() {
    val h = VaultFormat.create(password, recoveryKey, KdfParams(2048, 2, 1)).first
    val k = ByteArray(32)
    assertThrows(KdfOutOfRange::class.java) { VaultFormat.withNewPassword(h, k, password, KdfParams(1024, 2, 1)) }
    assertThrows(KdfOutOfRange::class.java) { VaultFormat.withNewPassword(h, k, password, KdfParams(2048, 1, 1)) }
    assertEquals(h.kdf, VaultFormat.withNewPassword(h, k, password).kdf)
    val raised = KdfParams(4096, 3, 2)
    val h2 = VaultFormat.withNewPassword(h, k, password, raised)
    assertEquals(raised, h2.kdf)
    assertArrayEquals(k, VaultFormat.unlockWithPassword(h2, password))
    assertThrows(KdfOutOfRange::class.java) { VaultFormat.withNewPassword(h2, k, password, h.kdf) }
  }

  @Test fun outOfRangeParamsAreRefusedWhenSettingAPassword() {
    val (h, k) = newVault()
    for (kdf in listOf(KdfParams(1048577, 1, 1), KdfParams(1024, 17, 1), KdfParams(1024, 1, 5), KdfParams(1024, 1, 0))) {
      assertThrows(kdf.toString(), KdfOutOfRange::class.java) { VaultFormat.withNewPassword(h, k, password, kdf) }
    }
    assertThrows(KdfOutOfRange::class.java) { VaultFormat.create(password, recoveryKey, KdfParams(512, 1, 1)) }
  }

  private fun vectors(): JsonObject =
    Json.parseToJsonElement(javaClass.classLoader!!.getResource("vault-vectors.json")!!.readText()).jsonObject

  private fun JsonObject.hex(key: String) = this[key]!!.jsonPrimitive.content.fromHex()

  private fun JsonObject.text(key: String) = this[key]!!.jsonPrimitive.content

  @Test fun vectorsFileStillMatches() {
    val v = vectors()
    val kdf = v["kdf"]!!.jsonObject.let { KdfParams(it.text("memoryKiB").toInt(), it.text("iterations").toInt(), it.text("parallelism").toInt()) }
    val salt = v.hex("salt")
    val vaultKey = v.hex("vaultKey")

    val pw = v["password"]!!.jsonObject
    val masterKey = Crypto.argon2id(pw.text("text").toCharArray(), salt, kdf)
    val wrapKey = Crypto.hkdf(masterKey, "strongroom/v1/wrap")
    assertEquals("masterKey", pw.text("masterKey"), masterKey.toHex())
    assertEquals("wrapKey", pw.text("wrapKey"), wrapKey.toHex())
    assertEquals("loginToken", pw.text("loginToken"), Crypto.hkdf(masterKey, "strongroom/v1/login").toHex())

    val nfd = v["nfdPassword"]!!.jsonObject
    assertNotEquals(nfd.text("nfd"), nfd.text("nfc"))
    assertEquals(nfd.text("nfc"), Normalizer.normalize(nfd.text("nfd"), Normalizer.Form.NFC))
    assertEquals("NFC form", nfd.text("masterKey"), Crypto.argon2id(nfd.text("nfc").toCharArray(), salt, kdf).toHex())
    assertEquals("NFD form", nfd.text("masterKey"), Crypto.argon2id(nfd.text("nfd").toCharArray(), salt, kdf).toHex())
    for (name in listOf("urduPassword", "emojiPassword")) {
      val p = v[name]!!.jsonObject
      assertEquals("$name is NFC", p.text("text"), Normalizer.normalize(p.text("text"), Normalizer.Form.NFC))
      assertEquals(name, p.text("masterKey"), Crypto.argon2id(p.text("text").toCharArray(), salt, kdf).toHex())
    }

    val recovery = v["recovery"]!!.jsonObject
    val recoveryWrapKey = Crypto.hkdf(recovery.hex("key"), "strongroom/v1/wrap")
    assertEquals("recovery wrapKey", recovery.text("wrapKey"), recoveryWrapKey.toHex())
    assertEquals("recovery loginToken", recovery.text("loginToken"), Crypto.hkdf(recovery.hex("key"), "strongroom/v1/login").toHex())

    for ((name, key) in listOf("passwordWrap" to wrapKey, "recoveryWrap" to recoveryWrapKey)) {
      val wrap = v[name]!!.jsonObject
      val sealed = wrap.hex("sealed")
      assertEquals(name, "strongroom/v1/" + if (name == "passwordWrap") "password-wrap" else "recovery-wrap", wrap.text("aad"))
      assertArrayEquals("$name nonce prefix", wrap.hex("nonce"), sealed.copyOfRange(0, 12))
      assertArrayEquals(name, vaultKey, Crypto.open(key, sealed, wrap.text("aad").toByteArray(Charsets.UTF_8)))
    }

    val header = Header.fromJson(v["header"]!!.toString())
    assertNotNull("header", header)
    assertEquals(kdf, header!!.kdf)
    assertArrayEquals(salt, header.salt)
    assertArrayEquals(vaultKey, VaultFormat.unlockWithPassword(header, pw.text("text").toCharArray()))
    assertArrayEquals(vaultKey, VaultFormat.unlockWithRecovery(header, recovery.hex("key")))
    assertEquals(v["passwordWrap"]!!.jsonObject.text("sealed"), header.passwordWrap.toHex())
    assertEquals(v["recoveryWrap"]!!.jsonObject.text("sealed"), header.recoveryWrap.toHex())

    val records: JsonArray = v["records"]!!.jsonArray
    assertEquals(listOf("login", "card", "note", "deleted"), records.map { it.jsonObject["entry"]!!.jsonObject.text("type") })
    for (r in records.map { it.jsonObject }) {
      val id = r.text("id")
      val sealed = r.hex("sealed")
      val expected = r["entry"]!!.jsonObject
      assertEquals(id, "strongroom/v1/record/$id", r.text("aad"))
      assertArrayEquals("$id nonce prefix", r.hex("nonce"), sealed.copyOfRange(0, 12))
      val plain = Crypto.open(vaultKey, sealed, r.text("aad").toByteArray(Charsets.UTF_8))
      assertNotNull(id, plain)
      assertEquals(id, expected, Json.parseToJsonElement(String(plain!!, Charsets.UTF_8)))
      val entry = VaultFormat.openEntry(vaultKey, id, sealed)
      assertNotNull(id, entry)
      assertEquals(id, entry, EntryJson.decode(expected.toString()))
      assertEquals(id, expected, Json.parseToJsonElement(EntryJson.encode(entry!!)))
    }
    val login = VaultFormat.openEntry(vaultKey, records[0].jsonObject.text("id"), records[0].jsonObject.hex("sealed")) as Entry.Login
    assertEquals(listOf(true, false), login.apps.map { it.domain != null })
    assertTrue(login.apps.all { it.app.certSha256.length == 64 })
  }
}
