package expo.modules.strongroomvault.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.util.Base64

class KdfOutOfRange(val kdf: KdfParams) : Exception("KDF parameters out of range")

class AccountKeyRequired : Exception("This vault needs its account key")

class PasswordKeys(val wrapKey: ByteArray, val loginToken: ByteArray, val readToken: ByteArray)

class Opened(val vaultKey: ByteArray, val loginToken: ByteArray, val readToken: ByteArray)

data class Header(
  val version: Int,
  val kdf: KdfParams,
  val salt: ByteArray,
  val passwordWrap: ByteArray,
  val recoveryWrap: ByteArray,
  val accountKey: Boolean = false,
) {
  override fun equals(other: Any?) = other is Header && version == other.version && kdf == other.kdf &&
    salt.contentEquals(other.salt) && passwordWrap.contentEquals(other.passwordWrap) &&
    recoveryWrap.contentEquals(other.recoveryWrap) && accountKey == other.accountKey

  override fun hashCode() =
    listOf(version, kdf, salt.contentHashCode(), passwordWrap.contentHashCode(), recoveryWrap.contentHashCode(), accountKey).hashCode()

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
    if (accountKey) put("accountKey", true) // last and only when set, so an unflagged header keeps its Phase 1 bytes
  }.toString()

  companion object {
    private const val MAX_JSON_CHARS = 4096

    fun fromJson(s: String): Header? = if (s.length > MAX_JSON_CHARS) null else try { // a real header is about 250 chars
      val o = Json.parseToJsonElement(s).jsonObject
      val k = o.obj("kdf")
      val b64 = Base64.getDecoder()
      val version = o.int("version")
      val salt = b64.decode(o.string("salt"))
      val flagged = "accountKey" in o // only the boolean true: bool() throws on "true", 1 and null, false is refused here
      if (version != VaultFormat.VERSION || salt.size != VaultFormat.SALT_BYTES || (flagged && !o.bool("accountKey"))) null
      else Header(
        version,
        KdfParams(k.int("memoryKiB"), k.int("iterations"), k.int("parallelism")),
        salt,
        b64.decode(o.string("passwordWrap")),
        b64.decode(o.string("recoveryWrap")),
        flagged,
      )
    } catch (e: IllegalArgumentException) {
      null // SerializationException, a wrong JSON type and bad Base64 are all IllegalArgumentExceptions
    } catch (e: StackOverflowError) {
      null // kotlinx recurses on array nesting; an Error would slip past callers' catch (e: Exception)
    }
  }
}

object VaultFormat {
  const val VERSION = 1
  internal const val SALT_BYTES = 16
  internal const val VAULT_KEY_BYTES = 32
  private const val ACCOUNT_KEY_BYTES = 20
  private const val WRAP_LABEL = "strongroom/v1/wrap"
  private const val LOGIN_LABEL = "strongroom/v1/login"
  private const val READ_LABEL = "strongroom/v1/read"
  private val ACCOUNT_LABEL = "strongroom/v1/account".toByteArray(Charsets.UTF_8)
  private val PASSWORD_WRAP_AAD = "strongroom/v1/password-wrap".toByteArray(Charsets.UTF_8)
  private val RECOVERY_WRAP_AAD = "strongroom/v1/recovery-wrap".toByteArray(Charsets.UTF_8)

  fun create(
    password: CharArray,
    recoveryKey: ByteArray,
    kdf: KdfParams = KdfParams.DEFAULT,
    accountKey: ByteArray? = null,
  ): Pair<Header, ByteArray> {
    if (!kdf.inRange()) throw KdfOutOfRange(kdf) // a vault this device would then refuse to open
    val vaultKey = Crypto.randomBytes(VAULT_KEY_BYTES)
    val salt = Crypto.randomBytes(SALT_BYTES)
    val header = Header(
      VERSION,
      kdf,
      salt,
      passwordWrap(password, salt, kdf, vaultKey, accountKey),
      recoveryWrap(recoveryKey, vaultKey),
      accountKey != null,
    )
    return header to vaultKey
  }

  fun derivePasswordKeys(password: CharArray, salt: ByteArray, kdf: KdfParams, flagged: Boolean, accountKey: ByteArray?): PasswordKeys {
    if (!kdf.inRange()) throw KdfOutOfRange(kdf)
    if (flagged && accountKey == null) throw AccountKeyRequired()
    return passwordKeys(password, salt, kdf, accountKey)
  }

  fun openPasswordWrap(h: Header, wrapKey: ByteArray): ByteArray? = Crypto.open(wrapKey, h.passwordWrap, PASSWORD_WRAP_AAD)

  /** A given account key is mixed in even without the flag, so a header stripped of it opens nothing instead of falling back to the password alone. */
  fun openWithPassword(h: Header, password: CharArray, accountKey: ByteArray? = null): Opened? {
    val k = derivePasswordKeys(password, h.salt, h.kdf, h.accountKey, accountKey)
    val vaultKey = unwrap(k.wrapKey, h.passwordWrap, PASSWORD_WRAP_AAD)
    if (vaultKey != null) return Opened(vaultKey, k.loginToken, k.readToken)
    k.loginToken.fill(0)
    k.readToken.fill(0)
    return null
  }

  fun unlockWithPassword(h: Header, password: CharArray, accountKey: ByteArray? = null): ByteArray? =
    openWithPassword(h, password, accountKey)?.let {
      it.loginToken.fill(0)
      it.readToken.fill(0)
      it.vaultKey
    }

  fun unlockWithRecovery(h: Header, recoveryKey: ByteArray): ByteArray? =
    unwrap(Crypto.hkdf(recoveryKey, WRAP_LABEL), h.recoveryWrap, RECOVERY_WRAP_AAD)

  fun recoveryLoginToken(recoveryKey: ByteArray): ByteArray = Crypto.hkdf(recoveryKey, LOGIN_LABEL)

  fun withNewPassword(h: Header, vaultKey: ByteArray, password: CharArray, kdf: KdfParams = h.kdf, accountKey: ByteArray? = null): Header {
    val lower = kdf.memoryKiB < h.kdf.memoryKiB || kdf.iterations < h.kdf.iterations || kdf.parallelism < h.kdf.parallelism
    if (!kdf.inRange() || lower) throw KdfOutOfRange(kdf)
    if (h.accountKey && accountKey == null) throw AccountKeyRequired()
    val salt = Crypto.randomBytes(SALT_BYTES)
    return h.copy(kdf = kdf, salt = salt, passwordWrap = passwordWrap(password, salt, kdf, vaultKey, accountKey), accountKey = accountKey != null)
  }

  /** Unverified on purpose, like withNewPassword: Task 6's caller proves [password] opens [h] first, so a typo can't become the master password. */
  fun withAccountKey(h: Header, vaultKey: ByteArray, password: CharArray, accountKey: ByteArray): Header =
    withNewPassword(h, vaultKey, password, h.kdf, accountKey)

  fun withNewRecovery(h: Header, vaultKey: ByteArray, recoveryKey: ByteArray): Header =
    h.copy(recoveryWrap = recoveryWrap(recoveryKey, vaultKey))

  fun sealEntry(vaultKey: ByteArray, id: String, e: Entry): ByteArray {
    val plain = Crypto.utf8(EntryJson.encode(e))
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

  private fun recordAad(id: String) = Crypto.utf8("strongroom/v1/record/$id")

  // One Argon2 run. An account key is mixed in before the split, so the wrap and both tokens need both secrets.
  private fun passwordKeys(password: CharArray, salt: ByteArray, kdf: KdfParams, accountKey: ByteArray?): PasswordKeys {
    require(accountKey == null || accountKey.size == ACCOUNT_KEY_BYTES) { "An account key is 20 bytes" }
    val argon = Crypto.argon2id(password, salt, kdf)
    val master = accountKey?.let { Crypto.hkdf(argon, it, ACCOUNT_LABEL, 32) } ?: argon
    try {
      return PasswordKeys(Crypto.hkdf(master, WRAP_LABEL), Crypto.hkdf(master, LOGIN_LABEL), Crypto.hkdf(master, READ_LABEL))
    } finally {
      argon.fill(0)
      master.fill(0)
    }
  }

  private fun passwordWrap(password: CharArray, salt: ByteArray, kdf: KdfParams, vaultKey: ByteArray, accountKey: ByteArray?): ByteArray {
    val k = passwordKeys(password, salt, kdf, accountKey)
    k.loginToken.fill(0)
    k.readToken.fill(0)
    return wrap(k.wrapKey, vaultKey, PASSWORD_WRAP_AAD)
  }

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
