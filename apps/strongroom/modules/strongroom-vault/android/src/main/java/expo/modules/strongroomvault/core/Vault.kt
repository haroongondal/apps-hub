package expo.modules.strongroomvault.core

import java.security.MessageDigest
import java.util.UUID

// Reserved id of the tombstone setUp writes, so unlockWithKey always has a record to verify a key against.
private const val KEY_CHECK_ID = "key-check"

data class Row(val id: String, val type: String, val name: String, val subtitle: String)

/** The unlocked vault. Every member is synchronized so lock() can't zero the key under a seal in flight. */
class Vault(private val store: RecordStore, private val clock: () -> Long, private val elapsed: () -> Long) {
  private var key: ByteArray? = null
  private var lastUsedAt = 0L
  private var unreadableCount = 0
  private var timeoutMinutes = 5

  var autoLockMinutes: Int
    @Synchronized get() {
      live()
      return timeoutMinutes
    }
    @Synchronized set(m) {
      require(LockPolicy.validTimeout(m)) { "auto-lock is 1, 5 or 15 minutes" }
      live() // an expired session must not be revived by a longer timeout
      timeoutMinutes = m
    }

  @get:Synchronized val isSetUp: Boolean
    get() {
      live()
      return store.header() != null
    }

  @get:Synchronized val isUnlocked: Boolean get() = live() != null

  @get:Synchronized val unreadable: Int
    get() {
      live()
      return unreadableCount
    }

  @Synchronized fun setUp(password: CharArray, recoveryKey: ByteArray, kdf: KdfParams = KdfParams.DEFAULT) {
    check(store.header() == null) { "already set up" }
    val (header, k) = VaultFormat.create(password, recoveryKey, kdf)
    zeroOnThrow(k) {
      // Record first: a failed write then leaves no header, so setUp can be retried (the retry overwrites an orphan).
      store.putAll(mapOf(KEY_CHECK_ID to VaultFormat.sealEntry(k, KEY_CHECK_ID, Entry.Deleted(clock()))))
      store.putHeader(header.toJson())
      install(k, countUnreadable(k))
    }
  }

  @Synchronized fun unlock(password: CharArray): Boolean {
    val k = VaultFormat.unlockWithPassword(header(), password) ?: return false
    zeroOnThrow(k) { install(k, countUnreadable(k)) }
    return true
  }

  @Synchronized fun recover(recoveryKey: ByteArray, newPassword: CharArray): Boolean {
    val h = header()
    val k = VaultFormat.unlockWithRecovery(h, recoveryKey) ?: return false
    zeroOnThrow(k) {
      val bad = countUnreadable(k) // before the header write, so a failed read changes nothing
      store.putHeader(VaultFormat.withNewPassword(h, k, newPassword).toJson())
      install(k, bad)
    }
    return true
  }

  @Synchronized fun unlockWithKey(vaultKey: ByteArray): Boolean {
    if (vaultKey.size != VaultFormat.VAULT_KEY_BYTES || store.header() == null) return false
    val k = vaultKey.copyOf()
    return zeroOnThrow(k) {
      val records = store.all()
      val bad = countUnreadable(k, records)
      val opensSomething = bad < records.size
      if (opensSomething) install(k, bad) else k.fill(0)
      opensSomething
    }
  }

  @Synchronized fun touch() {
    if (live() != null) lastUsedAt = elapsed()
  }

  @Synchronized fun lock() {
    key?.fill(0)
    key = null
  }

  @Synchronized fun rows(): List<Row> =
    all().mapNotNull { (id, e) ->
      when (e) {
        is Entry.Login -> Row(id, "login", e.name, e.username)
        is Entry.Card -> Row(id, "card", e.name, "\u2022\u2022\u2022\u2022 " + e.number.filter(Char::isDigit).takeLast(4))
        is Entry.Note -> Row(id, "note", e.name, "")
        is Entry.Deleted -> null
      }
    }.sortedWith(compareBy({ it.name.lowercase() }, { it.id }))

  @Synchronized fun get(id: String): Entry? {
    val k = requireKey()
    return store.all()[id]?.let { VaultFormat.openEntry(k, id, it) }?.takeIf { it !is Entry.Deleted }
  }

  @Synchronized fun all(): Map<String, Entry> {
    val k = requireKey()
    return store.all().mapNotNull { (id, sealed) ->
      VaultFormat.openEntry(k, id, sealed)?.takeIf { it !is Entry.Deleted }?.let { id to it }
    }.toMap()
  }

  @Synchronized fun put(id: String?, e: Entry): String {
    val k = requireKey()
    require(id != KEY_CHECK_ID) { "reserved id" }
    val rid = id ?: UUID.randomUUID().toString()
    store.putAll(mapOf(rid to VaultFormat.sealEntry(k, rid, e.stamped(clock()))))
    return rid
  }

  @Synchronized fun delete(id: String) {
    val k = requireKey()
    require(id != KEY_CHECK_ID) { "reserved id" }
    store.putAll(mapOf(id to VaultFormat.sealEntry(k, id, Entry.Deleted(clock()))))
  }

  @Synchronized fun putMany(entries: List<Entry>): Int {
    val k = requireKey()
    val now = clock()
    store.putAll(entries.associate {
      val id = UUID.randomUUID().toString()
      id to VaultFormat.sealEntry(k, id, it.stamped(now))
    })
    return entries.size
  }

  @Synchronized fun changePassword(old: CharArray, new: CharArray): Boolean {
    val k = requireKey()
    val h = header()
    if (!passwordMatches(h, old, k)) return false
    store.putHeader(VaultFormat.withNewPassword(h, k, new).toJson())
    return true
  }

  @Synchronized fun newRecoveryKey(password: CharArray): ByteArray? {
    val k = requireKey()
    val h = header()
    if (!passwordMatches(h, password, k)) return null
    val recoveryKey = RecoveryKey.generate()
    store.putHeader(VaultFormat.withNewRecovery(h, k, recoveryKey).toJson())
    return recoveryKey
  }

  @Synchronized fun vaultKeyCopy(password: CharArray): ByteArray? {
    val k = requireKey()
    return if (passwordMatches(header(), password, k)) k.copyOf() else null
  }

  private fun header(): Header {
    val json = store.header() ?: throw IllegalStateException("not set up")
    return Header.fromJson(json) ?: throw IllegalStateException("header unreadable")
  }

  // Locks first when the timeout has passed, so nothing is ever served from an expired session.
  private fun live(): ByteArray? {
    val k = key ?: return null
    if (LockPolicy.expired(lastUsedAt, elapsed(), timeoutMinutes)) {
      lock()
      return null
    }
    return k
  }

  private fun requireKey(): ByteArray = live() ?: throw IllegalStateException("locked")

  private fun install(k: ByteArray, unreadable: Int) {
    val now = elapsed()
    key?.fill(0)
    key = k
    unreadableCount = unreadable
    lastUsedAt = now
  }

  private inline fun <T> zeroOnThrow(k: ByteArray, block: () -> T): T =
    try {
      block()
    } catch (e: Exception) {
      k.fill(0)
      throw e
    }

  private fun countUnreadable(k: ByteArray, records: Map<String, ByteArray> = store.all()) =
    records.count { (id, sealed) -> VaultFormat.openEntry(k, id, sealed) == null }

  // A password that unwraps a different key than the one in memory means the session key is wrong: lock.
  private fun passwordMatches(h: Header, password: CharArray, sessionKey: ByteArray): Boolean {
    val derived = VaultFormat.unlockWithPassword(h, password) ?: return false
    try {
      if (MessageDigest.isEqual(derived, sessionKey)) return true
      lock()
      return false
    } finally {
      derived.fill(0)
    }
  }
}

private fun Entry.stamped(t: Long): Entry = when (this) {
  is Entry.Login -> copy(updatedAt = t)
  is Entry.Card -> copy(updatedAt = t)
  is Entry.Note -> copy(updatedAt = t)
  is Entry.Deleted -> copy(updatedAt = t)
}
