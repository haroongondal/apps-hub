package expo.modules.strongroomvault.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.util.Base64

class KdfOutOfRange(val kdf: KdfParams) : Exception("KDF parameters out of range")

data class Header(
  val version: Int,
  val kdf: KdfParams,
  val salt: ByteArray,
  val passwordWrap: ByteArray,
  val recoveryWrap: ByteArray,
) {
  override fun equals(other: Any?) = other is Header && version == other.version && kdf == other.kdf &&
    salt.contentEquals(other.salt) && passwordWrap.contentEquals(other.passwordWrap) &&
    recoveryWrap.contentEquals(other.recoveryWrap)

  override fun hashCode() = listOf(version, kdf, salt.contentHashCode(), passwordWrap.contentHashCode(), recoveryWrap.contentHashCode()).hashCode()

  fun toJson(): String = buildJsonObject {
    val b64 = Base64.getEncoder()
    put("version", version)
    putJsonObject("kdf") {
      put("memoryKiB", kdf.memoryKiB)
      put("iterations", kdf.iterations)
      put("parallelism", kdf.parallelism)
    }
    put("salt", b64.encodeToString(salt))
    put("passwordWrap", b64.encodeToString(passwordWrap))
    put("recoveryWrap", b64.encodeToString(recoveryWrap))
  }.toString()

  companion object {
    fun fromJson(s: String): Header? = try {
      val o = Json.parseToJsonElement(s).jsonObject
      val k = o.obj("kdf")
      val b64 = Base64.getDecoder()
      val version = o.int("version")
      val salt = b64.decode(o.string("salt"))
      if (version != VaultFormat.VERSION || salt.size != VaultFormat.SALT_BYTES) null
      else Header(
        version,
        KdfParams(k.int("memoryKiB"), k.int("iterations"), k.int("parallelism")),
        salt,
        b64.decode(o.string("passwordWrap")),
        b64.decode(o.string("recoveryWrap")),
      )
    } catch (e: IllegalArgumentException) {
      null // SerializationException, a wrong JSON type and bad Base64 are all IllegalArgumentExceptions
    }
  }
}

object VaultFormat {
  const val VERSION = 1
  internal const val SALT_BYTES = 16
  private const val VAULT_KEY_BYTES = 32
  private const val WRAP_LABEL = "strongroom/v1/wrap"
  private val PASSWORD_WRAP_AAD = "strongroom/v1/password-wrap".toByteArray(Charsets.UTF_8)
  private val RECOVERY_WRAP_AAD = "strongroom/v1/recovery-wrap".toByteArray(Charsets.UTF_8)

  fun create(password: CharArray, recoveryKey: ByteArray, kdf: KdfParams = KdfParams.DEFAULT): Pair<Header, ByteArray> {
    if (!kdf.inRange()) throw KdfOutOfRange(kdf) // a vault this device would then refuse to open
    val vaultKey = Crypto.randomBytes(VAULT_KEY_BYTES)
    val salt = Crypto.randomBytes(SALT_BYTES)
    val header = Header(
      VERSION,
      kdf,
      salt,
      passwordWrap(password, salt, kdf, vaultKey),
      recoveryWrap(recoveryKey, vaultKey),
    )
    return header to vaultKey
  }

  fun unlockWithPassword(h: Header, password: CharArray): ByteArray? {
    if (!h.kdf.inRange()) throw KdfOutOfRange(h.kdf)
    return unwrap(passwordWrapKey(password, h.salt, h.kdf), h.passwordWrap, PASSWORD_WRAP_AAD)
  }

  fun unlockWithRecovery(h: Header, recoveryKey: ByteArray): ByteArray? =
    unwrap(Crypto.hkdf(recoveryKey, WRAP_LABEL), h.recoveryWrap, RECOVERY_WRAP_AAD)

  fun withNewPassword(h: Header, vaultKey: ByteArray, password: CharArray, kdf: KdfParams = h.kdf): Header {
    val lower = kdf.memoryKiB < h.kdf.memoryKiB || kdf.iterations < h.kdf.iterations || kdf.parallelism < h.kdf.parallelism
    if (!kdf.inRange() || lower) throw KdfOutOfRange(kdf)
    val salt = Crypto.randomBytes(SALT_BYTES)
    return h.copy(kdf = kdf, salt = salt, passwordWrap = passwordWrap(password, salt, kdf, vaultKey))
  }

  fun withNewRecovery(h: Header, vaultKey: ByteArray, recoveryKey: ByteArray): Header =
    h.copy(recoveryWrap = recoveryWrap(recoveryKey, vaultKey))

  fun sealEntry(vaultKey: ByteArray, id: String, e: Entry): ByteArray {
    val plain = EntryJson.encode(e).toByteArray(Charsets.UTF_8)
    try {
      return Crypto.seal(vaultKey, plain, recordAad(id))
    } finally {
      plain.fill(0)
    }
  }

  fun openEntry(vaultKey: ByteArray, id: String, sealed: ByteArray): Entry? {
    val plain = Crypto.open(vaultKey, sealed, recordAad(id)) ?: return null
    try {
      return EntryJson.decode(String(plain, Charsets.UTF_8))
    } finally {
      plain.fill(0)
    }
  }

  private fun recordAad(id: String) = "strongroom/v1/record/$id".toByteArray(Charsets.UTF_8)

  private fun passwordWrapKey(password: CharArray, salt: ByteArray, kdf: KdfParams): ByteArray {
    val masterKey = Crypto.argon2id(password, salt, kdf)
    try {
      return Crypto.hkdf(masterKey, WRAP_LABEL)
    } finally {
      masterKey.fill(0)
    }
  }

  private fun passwordWrap(password: CharArray, salt: ByteArray, kdf: KdfParams, vaultKey: ByteArray) =
    wrap(passwordWrapKey(password, salt, kdf), vaultKey, PASSWORD_WRAP_AAD)

  private fun recoveryWrap(recoveryKey: ByteArray, vaultKey: ByteArray) =
    wrap(Crypto.hkdf(recoveryKey, WRAP_LABEL), vaultKey, RECOVERY_WRAP_AAD)

  private fun wrap(wrapKey: ByteArray, vaultKey: ByteArray, aad: ByteArray): ByteArray =
    try {
      Crypto.seal(wrapKey, vaultKey, aad)
    } finally {
      wrapKey.fill(0)
    }

  private fun unwrap(wrapKey: ByteArray, wrapped: ByteArray, aad: ByteArray): ByteArray? =
    try {
      Crypto.open(wrapKey, wrapped, aad)
    } finally {
      wrapKey.fill(0)
    }
}
