package expo.modules.strongroomvault.core

import java.util.UUID

data class Row(val id: String, val type: String, val name: String, val subtitle: String)

/** The unlocked vault. Every member is synchronized so lock() can't zero the key under a seal in flight. */
class Vault(private val store: RecordStore, private val clock: () -> Long, private val elapsed: () -> Long) {
  private var key: ByteArray? = null
  private var lastUsedAt = 0L
  private var unreadableCount = 0
  private var timeoutMinutes = 5

  var autoLockMinutes: Int
    @Synchronized get() = timeoutMinutes
    @Synchronized set(m) {
      require(LockPolicy.validTimeout(m)) { "auto-lock is 1, 5 or 15 minutes" }
      live() // an expired session must not be revived by a longer timeout
      timeoutMinutes = m
    }

  @get:Synchronized val isSetUp: Boolean get() = store.header() != null

  @get:Synchronized val isUnlocked: Boolean get() = live() != null

  @get:Synchronized val unreadable: Int get() = unreadableCount

  @Synchronized fun setUp(password: CharArray, recoveryKey: ByteArray, kdf: KdfParams = KdfParams.DEFAULT) {
    check(store.header() == null) { "already set up" }
    val (header, k) = VaultFormat.create(password, recoveryKey, kdf)
    try {
      store.putHeader(header.toJson())
      install(k, countUnreadable(k))
    } catch (e: Exception) {
      k.fill(0)
      throw e
    }
  }

  @Synchronized fun unlock(password: CharArray): Boolean {
    val k = VaultFormat.unlockWithPassword(header(), password) ?: return false
    install(k, countUnreadable(k))
    return true
  }

  @Synchronized fun recover(recoveryKey: ByteArray, newPassword: CharArray): Boolean {
    val h = header()
    val k = VaultFormat.unlockWithRecovery(h, recoveryKey) ?: return false
    try {
      store.putHeader(VaultFormat.withNewPassword(h, k, newPassword).toJson())
      install(k, countUnreadable(k))
    } catch (e: Exception) {
      k.fill(0)
      throw e
    }
    return true
  }

  @Synchronized fun unlockWithKey(vaultKey: ByteArray): Boolean {
    if (vaultKey.size != VaultFormat.VAULT_KEY_BYTES) return false
    val k = vaultKey.copyOf()
    val records = store.all()
    val bad = countUnreadable(k, records)
    if (records.isNotEmpty() && bad == records.size) {
      k.fill(0)
      return false
    }
    install(k, bad)
    return true
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
    val rid = id ?: UUID.randomUUID().toString()
    store.putAll(mapOf(rid to VaultFormat.sealEntry(k, rid, e.stamped(clock()))))
    return rid
  }

  @Synchronized fun delete(id: String) {
    val k = requireKey()
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
    if (!passwordMatches(h, old)) return false
    store.putHeader(VaultFormat.withNewPassword(h, k, new).toJson())
    return true
  }

  @Synchronized fun newRecoveryKey(password: CharArray): ByteArray? {
    val k = requireKey()
    val h = header()
    if (!passwordMatches(h, password)) return null
    val recoveryKey = RecoveryKey.generate()
    store.putHeader(VaultFormat.withNewRecovery(h, k, recoveryKey).toJson())
    return recoveryKey
  }

  @Synchronized fun vaultKeyCopy(password: CharArray): ByteArray? {
    val k = requireKey()
    return if (passwordMatches(header(), password)) k.copyOf() else null
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
    key?.fill(0)
    key = k
    unreadableCount = unreadable
    lastUsedAt = elapsed()
  }

  private fun countUnreadable(k: ByteArray, records: Map<String, ByteArray> = store.all()) =
    records.count { (id, sealed) -> VaultFormat.openEntry(k, id, sealed) == null }

  private fun passwordMatches(h: Header, password: CharArray): Boolean {
    val k = VaultFormat.unlockWithPassword(h, password) ?: return false
    k.fill(0)
    return true
  }
}

private fun Entry.stamped(t: Long): Entry = when (this) {
  is Entry.Login -> copy(updatedAt = t)
  is Entry.Card -> copy(updatedAt = t)
  is Entry.Note -> copy(updatedAt = t)
  is Entry.Deleted -> copy(updatedAt = t)
}
