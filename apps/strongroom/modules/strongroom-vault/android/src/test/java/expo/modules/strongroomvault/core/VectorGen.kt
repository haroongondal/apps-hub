package expo.modules.strongroomvault.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.text.Normalizer
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

internal fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

internal fun String.fromHex(): ByteArray = chunked(2).map { it.toInt(16).toByte() }.toByteArray()

class VectorGen {
  private class Record(val id: String, val nonce: ByteArray, val entry: Entry)

  private val kdf = KdfParams(1024, 1, 1)
  private val salt = ByteArray(16) { it.toByte() }
  private val recoveryKey = ByteArray(20) { (0x10 + it).toByte() }
  private val vaultKey = ByteArray(32) { (0x40 + it).toByte() }
  private val password = "correct horse battery staple"
  private val nfc = "Cr\u00e8me br\u00fbl\u00e9e 2026"
  private val nfd = Normalizer.normalize(nfc, Normalizer.Form.NFD)

  private fun nonce(n: Int) = ByteArray(12) { n.toByte() }

  private fun cert(label: String) = MessageDigest.getInstance("SHA-256").digest(label.toByteArray()).toHex()

  private fun id(n: Int) = "00000000-0000-4000-8000-00000000000$n"

  private val records = listOf(
    Record(
      id(1),
      nonce(3),
      Entry.Login(
        name = "Caf\u00e9 Example",
        username = "me@example.com",
        password = "p\u00e4ss\\w0rd \"quoted\" \u2713 \uD83D\uDE00",
        sites = listOf(Site(true, "example.com"), Site(false, "intranet.local")),
        apps = listOf(
          AppLink(AppId("com.example.app", cert("strongroom vector cert 1")), "example.com"),
          AppLink(AppId("com.example.other", cert("strongroom vector cert 2")), null),
        ),
        note = "line one\nline two",
        updatedAt = 1_700_000_000_000,
      ),
    ),
    Record(id(2), nonce(4), Entry.Card("Visa", "A. Holder", "4111111111111111", 12, 2030, "123", "test number", 1_700_000_001_000)),
    Record(id(3), nonce(5), Entry.Note("Wi-Fi", "SSID: home\nkey: correct horse", 1_700_000_002_000)),
    Record(id(4), nonce(6), Entry.Deleted(1_700_000_003_000)),
  )

  // The only place a caller picks the nonce; main code never does.
  private fun sealWithNonce(key: ByteArray, nonce: ByteArray, plaintext: ByteArray, aad: String): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
    cipher.updateAAD(aad.toByteArray(Charsets.UTF_8))
    return nonce + cipher.doFinal(plaintext)
  }

  private fun build(): JsonObject {
    val masterKey = Crypto.argon2id(password.toCharArray(), salt, kdf)
    val wrapKey = Crypto.hkdf(masterKey, "strongroom/v1/wrap")
    val recoveryWrapKey = Crypto.hkdf(recoveryKey, "strongroom/v1/wrap")
    val passwordWrap = sealWithNonce(wrapKey, nonce(1), vaultKey, "strongroom/v1/password-wrap")
    val recoveryWrap = sealWithNonce(recoveryWrapKey, nonce(2), vaultKey, "strongroom/v1/recovery-wrap")
    val header = Header(VaultFormat.VERSION, kdf, salt, passwordWrap, recoveryWrap)
    return buildJsonObject {
      put(
        "note",
        "Shared Strongroom vault test vectors (format v1, DESIGN section 6). Kotlin and TypeScript tests read this same file. " +
          "Byte values are lowercase hex unless noted. " +
          "masterKey = Argon2id(password as UTF-8 after NFC normalisation, salt, kdf, 32 bytes, version 0x13). " +
          "wrapKey = HKDF-SHA-256(ikm = masterKey, no salt, info = UTF-8 'strongroom/v1/wrap', 32 bytes); " +
          "loginToken is the same with info 'strongroom/v1/login'. " +
          "recovery.wrapKey and recovery.loginToken use recovery.key as ikm with the same two labels (no Argon2). " +
          "Every sealed value is nonce(12) || ciphertext || tag(16): AES-256-GCM under the stated nonce with AAD = UTF-8 of the aad field. " +
          "passwordWrap seals vaultKey under wrapKey; recoveryWrap seals vaultKey under recovery.wrapKey. " +
          "Each record seals the compact JSON of its entry (UTF-8, keys in the order shown) under vaultKey. " +
          "header is the exact Header JSON, with salt and both wraps as standard padded Base64 (the only non-hex bytes). " +
          "nfdPassword.masterKey is the Argon2id key of both its NFD and its NFC form, so a client must normalise to NFC first. " +
          "Passwords are written with \\u escapes so an editor cannot normalise them.",
      )
      putJsonObject("kdf") {
        put("memoryKiB", kdf.memoryKiB)
        put("iterations", kdf.iterations)
        put("parallelism", kdf.parallelism)
      }
      put("salt", salt.toHex())
      put("vaultKey", vaultKey.toHex())
      putJsonObject("password") {
        put("text", password)
        put("masterKey", masterKey.toHex())
        put("wrapKey", wrapKey.toHex())
        put("loginToken", Crypto.hkdf(masterKey, "strongroom/v1/login").toHex())
      }
      putJsonObject("nfdPassword") {
        put("nfd", nfd)
        put("nfc", nfc)
        put("masterKey", Crypto.argon2id(nfc.toCharArray(), salt, kdf).toHex())
      }
      putJsonObject("recovery") {
        put("key", recoveryKey.toHex())
        put("wrapKey", recoveryWrapKey.toHex())
        put("loginToken", Crypto.hkdf(recoveryKey, "strongroom/v1/login").toHex())
      }
      putJsonObject("passwordWrap") {
        put("aad", "strongroom/v1/password-wrap")
        put("nonce", nonce(1).toHex())
        put("sealed", passwordWrap.toHex())
      }
      putJsonObject("recoveryWrap") {
        put("aad", "strongroom/v1/recovery-wrap")
        put("nonce", nonce(2).toHex())
        put("sealed", recoveryWrap.toHex())
      }
      put("header", Json.parseToJsonElement(header.toJson()))
      put(
        "records",
        buildJsonArray {
          for (r in records) {
            val json = EntryJson.encode(r.entry)
            val aad = "strongroom/v1/record/${r.id}"
            add(
              buildJsonObject {
                put("id", r.id)
                put("aad", aad)
                put("nonce", r.nonce.toHex())
                put("entry", Json.parseToJsonElement(json))
                put("sealed", sealWithNonce(vaultKey, r.nonce, json.toByteArray(Charsets.UTF_8), aad).toHex())
              },
            )
          }
        },
      )
    }
  }

  @Test fun writeVectors() {
    assumeTrue(
      "to regenerate, run from apps/strongroom/android: STRONGROOM_WRITE_VECTORS=1 ./gradlew " +
        ":strongroom-vault:cleanTestDebugUnitTest :strongroom-vault:testDebugUnitTest --tests '*VectorGen'",
      System.getenv("STRONGROOM_WRITE_VECTORS") == "1",
    )
    val pretty = Json { prettyPrint = true }.encodeToString(JsonObject.serializer(), build())
    val ascii = pretty.map { if (it.code > 0x7e) "\\u%04x".format(it.code) else it.toString() }.joinToString("")
    File("src/test/resources/vault-vectors.json").apply { parentFile?.mkdirs() }.writeText(ascii + "\n")
  }
}
