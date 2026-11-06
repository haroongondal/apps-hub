package expo.modules.strongroomvault.core

import java.security.MessageDigest

enum class SyncMode { OFF, PENDING_SETUP, ON, NEEDS_SIGN_IN }

internal const val HEADER_CHECK = "header check failed"
internal const val KEY_LOST = "sync key lost"

data class SyncState(
  val mode: SyncMode = SyncMode.OFF,
  val lastSyncAt: Long? = null,
  val blocked: Int = 0,
  val quarantined: Int = 0,
  val failed: Boolean = false,
  // The fingerprint of the local header an account update waits to send; set before that header is written.
  val pendingHeader: String? = null,
  val recoveryHash: String? = null,
) {
  val accountPending: Boolean get() = pendingHeader != null
}

interface SyncSettings {
  fun load(): SyncState

  fun save(s: SyncState)
}

// LOGIN_TOKEN and READ_TOKEN are always the ones the server knows; NEXT_* wait for an account update to land.
enum class SyncSecret { ACCOUNT_KEY, LOGIN_TOKEN, READ_TOKEN, NEXT_LOGIN, NEXT_READ }

interface SyncSecrets {
  fun get(s: SyncSecret): ByteArray?

  fun put(s: SyncSecret, value: ByteArray)

  fun delete(s: SyncSecret)

  fun reset()
}

data class SyncStatus(val state: String, val lastSyncAt: Long?, val blocked: Int, val quarantined: Int, val available: Boolean)

class SyncSession(
  private val vault: Vault,
  private val store: SyncRecordStore,
  private val secrets: SyncSecrets,
  private val settings: SyncSettings,
  private val transport: SyncTransport?,
  private val clock: () -> Long,
) {
  @Volatile private var running = false

  @Volatile var onChange: (() -> Unit)? = null

  val isOn: Boolean get() = transport != null && settings.load().mode == SyncMode.ON

  fun status(): SyncStatus {
    val s = settings.load()
    val state = when {
      transport == null || s.mode == SyncMode.OFF -> "off"
      s.mode == SyncMode.PENDING_SETUP -> "pendingSetup"
      s.mode == SyncMode.NEEDS_SIGN_IN -> "needsSignIn"
      running -> "syncing"
      s.failed -> "error"
      else -> "idle"
    }
    return SyncStatus(state, s.lastSyncAt, s.blocked, s.quarantined, transport != null)
  }

  /**
   * Null for a wrong password. Retry-safe: the key reaches the Keystore before the header that needs it, and a retry after the local commit only repeats the PUT.
   * A refusal that created nothing on the server (401, 400, or a 403 for an account that isn't this phone's) puts back this call's header and mode, so the vault
   * never depends on a key the owner hasn't seen; the Keystore keeps the key, so a retry shows the same one. Only an unclear failure (offline, 5xx, a lost reply) leaves setup pending.
   */
  @Synchronized fun enable(setupToken: String, password: CharArray, recoveryKey: ByteArray): ByteArray? {
    val t = server()
    val mode = settings.load().mode
    check(mode == SyncMode.OFF || mode == SyncMode.PENDING_SETUP) { "sync already on" }
    val k = vault.vaultKeyCopy(password) ?: return null
    try {
      val original = storedHeader()
      val h = header()
      check(VaultFormat.unlockWithRecovery(h, recoveryKey).sameKey(k)) { "wrong recovery key" }
      val ak = secrets.get(SyncSecret.ACCOUNT_KEY) ?: AccountKey.generate().also { secrets.put(SyncSecret.ACCOUNT_KEY, it) }
      try {
        val flagged = if (h.accountKey) h else VaultFormat.withAccountKey(h, k, password, ak)
        val opened = VaultFormat.openWithPassword(flagged, password, ak) ?: throw IllegalStateException(HEADER_CHECK)
        try {
          check(opened.vaultKey.copyOf().sameKey(k)) { HEADER_CHECK }
          secrets.put(SyncSecret.LOGIN_TOKEN, opened.loginToken)
          secrets.put(SyncSecret.READ_TOKEN, opened.readToken)
          update { it.copy(mode = SyncMode.PENDING_SETUP) }
          if (!h.accountKey) store.putHeader(flagged.toJson())
          val body = AccountCreate(
            storedHeader(),
            Crypto.tokenHash(opened.loginToken),
            hashOf(VaultFormat.recoveryLoginToken(recoveryKey)),
            Crypto.tokenHash(opened.readToken),
          )
          val undo = {
            if (!h.accountKey) store.putHeader(original)
            update { it.copy(mode = mode) }
          }
          val rev = try {
            t.putAccount(setupToken, body)
          } catch (e: SyncAuthError) {
            undo()
            throw IllegalStateException("wrong setup token")
          } catch (e: SyncHttpError) {
            if (e.status == 400) undo()
            if (e.status != 403) throw e
            createdEarlier(t, opened.loginToken) ?: run {
              undo()
              throw IllegalStateException("account exists")
            }
          }
          commitHeader(null, rev)
          update { it.copy(mode = SyncMode.ON, failed = false) }
        } finally {
          opened.wipe()
        }
        runCatching { syncWith(t, k, null) }
        return ak.copyOf()
      } finally {
        ak.fill(0)
      }
    } finally {
      k.fill(0)
    }
  }

  @Synchronized fun showAccountKey(password: CharArray): ByteArray? {
    val ak = secrets.get(SyncSecret.ACCOUNT_KEY) ?: throw IllegalStateException("sync off")
    val opens = try {
      vault.vaultKeyCopy(password)?.also { it.fill(0) } != null
    } catch (e: Throwable) {
      ak.fill(0)
      throw e
    }
    if (!opens) ak.fill(0)
    return ak.takeIf { opens }
  }

  @Synchronized fun signIn(password: CharArray, accountKey: ByteArray) {
    val t = server()
    val s = SyncClient.signInWithPassword(t, password, accountKey)
    try {
      if (!s.header.accountKey) throw SyncAuthError() // as adoptHeader: a header that dropped the flag is never taken
      val local = localFor(s, s.header)
      storeAll(listOfNotNull(SyncSecret.ACCOUNT_KEY to accountKey, SyncSecret.LOGIN_TOKEN to s.loginToken, s.readToken?.let { SyncSecret.READ_TOKEN to it }))
      commit(s, s.header, s.headerRev, local)
      signedIn(s.skipped)
    } finally {
      s.wipe()
    }
  }

  /** [accountKey] is the typed one, used only when the Keystore holds none (a new phone, or a lost entry). Nothing can check it before the PUT. */
  @Synchronized fun recover(recoveryKey: ByteArray, newPassword: CharArray, accountKey: ByteArray? = null) {
    val t = server()
    val ak = secrets.get(SyncSecret.ACCOUNT_KEY) ?: accountKey?.copyOf() ?: throw AccountKeyRequired()
    try {
      val s = SyncClient.signInWithRecovery(t, recoveryKey)
      try {
        if (!s.header.accountKey) throw SyncAuthError() // as signIn: a header that dropped the flag is never taken, nor flagged again
        val local = localFor(s, s.header)
        val h = VaultFormat.withNewPassword(s.header, s.vaultKey, newPassword, accountKey = ak)
        val o = VaultFormat.openWithPassword(h, newPassword, ak) ?: throw IllegalStateException(HEADER_CHECK)
        try {
          val rev = t.putAccount(s.loginToken, AccountUpdate(h.toJson(), Crypto.tokenHash(o.loginToken), Crypto.tokenHash(o.readToken), s.headerRev))
          storeAll(listOf(SyncSecret.ACCOUNT_KEY to ak, SyncSecret.LOGIN_TOKEN to o.loginToken, SyncSecret.READ_TOKEN to o.readToken))
          commit(s, h, rev, local)
          signedIn(s.skipped)
        } finally {
          o.wipe()
        }
      } finally {
        s.wipe()
      }
    } finally {
      ak.fill(0)
    }
  }

  @Synchronized fun sync(password: CharArray? = null): SyncReport {
    val t = server()
    when (settings.load().mode) {
      SyncMode.ON -> Unit
      SyncMode.NEEDS_SIGN_IN -> throw SyncAuthError()
      else -> throw IllegalStateException("sync off")
    }
    val k = vault.keyCopy() ?: throw IllegalStateException("locked")
    try {
      return syncWith(t, k, password)
    } finally {
      k.fill(0)
    }
  }

  @Synchronized fun download(): Int {
    val t = transport ?: return 0
    // A waiting account update goes first, at the next sync with the vault open.
    if (settings.load().let { it.mode != SyncMode.ON || it.accountPending }) return 0
    val token = secrets.get(SyncSecret.READ_TOKEN) ?: return 0
    try {
      return recording(offlineIsNormal = true) { SyncClient.download(store, t, token) }
    } finally {
      token.fill(0)
    }
  }

  // Every local header change goes through the session, so its sync bookkeeping is in place before the vault writes the header (prepare).
  @Synchronized fun changePassword(old: CharArray, new: CharArray): Boolean = vault.changePassword(old, new) { prepare(it, new, null) }

  // The password too, so the tokens sent are derived from the header sent, even when a dropped change left this phone's password unsent.
  @Synchronized fun newRecoveryKey(password: CharArray): ByteArray? =
    vault.newRecoveryKey(password) { h, rk -> prepare(h, password, hashOf(VaultFormat.recoveryLoginToken(rk))) }

  /**
   * Forgot master password, on this phone. [accountKey] is the typed one, used only on a flagged vault whose Keystore copy is gone. It is kept
   * last, just before the header write, so a reset that fails before then keeps no typo and a retry can correct it. Nothing can check it, so ask for it twice.
   */
  @Synchronized fun recoverLocally(recoveryKey: ByteArray, newPassword: CharArray, accountKey: ByteArray? = null): Boolean {
    val held = secrets.get(SyncSecret.ACCOUNT_KEY)?.also { it.fill(0) } != null
    val typed = accountKey.takeUnless { held }
    return vault.recover(recoveryKey, newPassword, typed) { h ->
      val keep = typed?.takeIf { h.accountKey }
      prepare(h, newPassword, null, keep)
      keep?.let { storeAll(listOf(SyncSecret.ACCOUNT_KEY to it)) }
    }
  }

  private fun server(): SyncTransport = transport ?: throw IllegalStateException("sync unavailable")

  private fun update(change: (SyncState) -> SyncState) = settings.save(change(settings.load()))

  private fun storedHeader(): String = store.header() ?: throw IllegalStateException("not set up")

  private fun header(): Header = Header.fromJson(storedHeader()) ?: throw IllegalStateException("header unreadable")

  private fun commitHeader(h: Header?, headerRev: Long) =
    store.applyPull(PullApplied(h, headerRev, emptyList(), emptyList(), emptyList(), store.syncMeta().lastRev))

  // Before the header write; a throw stops it. A mark for another header (a write that failed) is dropped first. The mark moves before NEXT_*
  // do: cut short in between, the mark names a header never written and the next sync drops it, instead of sending NEXT_* with the old header.
  private fun prepare(h: Header, newPassword: CharArray?, recoveryHash: String?, typedAccountKey: ByteArray? = null) {
    if (!isOn) return
    if (settings.load().pendingHeader != fingerprint(storedHeader())) dropPending()
    val o = newPassword?.let {
      val ak = typedAccountKey?.copyOf() ?: secrets.get(SyncSecret.ACCOUNT_KEY) ?: throw AccountKeyRequired()
      try {
        VaultFormat.openWithPassword(h, it, ak) ?: throw IllegalStateException(HEADER_CHECK)
      } finally {
        ak.fill(0)
      }
    }
    try {
      update { it.copy(pendingHeader = fingerprint(h.toJson()), recoveryHash = recoveryHash ?: it.recoveryHash) }
      // storeAll: on a Keystore key the system dropped, the offline reset (the typed key's whole point) must still work.
      if (o != null) storeAll(listOf(SyncSecret.NEXT_LOGIN to o.loginToken, SyncSecret.NEXT_READ to o.readToken))
    } finally {
      o?.wipe()
    }
  }

  private fun dropPending() {
    secrets.delete(SyncSecret.NEXT_LOGIN)
    secrets.delete(SyncSecret.NEXT_READ)
    update { it.copy(pendingHeader = null, recoveryHash = null) }
  }

  private fun syncWith(t: SyncTransport, k: ByteArray, password: CharArray?): SyncReport = recording {
    if (settings.load().accountPending) updateAccount(t)
    val token = secrets.get(SyncSecret.LOGIN_TOKEN) ?: throw SyncAuthError()
    try {
      val report = SyncClient.syncOnce(store, t, k, token)
      if (report.headerChanged && password != null) adopt(t, token, password, k)
      val held = store.quarantine().map { it.first }.distinct().size
      update { it.copy(lastSyncAt = clock(), blocked = report.blocked, quarantined = held, failed = false) }
      report
    } finally {
      token.fill(0)
    }
  }

  // A refused token asks for sign-in once and stops, never a retry loop, and keeps a pending update (only sign-in drops it); any other failure reads "error" until a run succeeds.
  private fun <T> recording(offlineIsNormal: Boolean = false, block: () -> T): T {
    running = true
    onChange?.invoke()
    try {
      return block()
    } catch (e: SyncAuthError) {
      update { it.copy(mode = SyncMode.NEEDS_SIGN_IN) }
      throw e
    } catch (e: SyncOfflineError) {
      if (!offlineIsNormal) update { it.copy(failed = true) }
      throw e
    } catch (e: Exception) {
      update { it.copy(failed = true) }
      throw e
    } finally {
      running = false
      onChange?.invoke()
    }
  }

  // Signed with the token the server knows; ifRev is the last header this phone took from it. The waiting tokens replace the known ones only
  // after the update landed, NEXT_* and the mark go last, so a run cut short anywhere is finished by the next (or, after a lost reply, by a sign-in).
  private fun updateAccount(t: SyncTransport) {
    val local = storedHeader()
    if (settings.load().pendingHeader != fingerprint(local)) return dropPending() // its header never reached the vault file
    val auth = secrets.get(SyncSecret.LOGIN_TOKEN) ?: throw SyncAuthError()
    val login = secrets.get(SyncSecret.NEXT_LOGIN) ?: auth.copyOf()
    val read = secrets.get(SyncSecret.NEXT_READ) ?: secrets.get(SyncSecret.READ_TOKEN)
    try {
      if (read == null) throw SyncAuthError()
      val body = AccountUpdate(local, Crypto.tokenHash(login), Crypto.tokenHash(read), store.syncMeta().headerRev, settings.load().recoveryHash)
      val rev = try {
        t.putAccount(auth, body)
      } catch (e: SyncHttpError) {
        throw if (e.status == 409) SyncAuthError() else e
      }
      commitHeader(null, rev)
      secrets.put(SyncSecret.LOGIN_TOKEN, login)
      secrets.put(SyncSecret.READ_TOKEN, read)
      dropPending()
    } finally {
      auth.fill(0)
      login.fill(0)
      read?.fill(0)
    }
  }

  private fun adopt(t: SyncTransport, token: ByteArray, password: CharArray, k: ByteArray) {
    val meta = store.syncMeta()
    val page = t.pull(token, meta.lastRev)
    val remote = Header.fromJson(page.header) ?: return
    if (page.headerRev < meta.headerRev) return
    val ak = secrets.get(SyncSecret.ACCOUNT_KEY)
    try {
      SyncClient.adoptHeader(header(), remote, password, ak, k)?.let { commitHeader(it, page.headerRev) }
    } finally {
      ak?.fill(0)
    }
  }

  // A 403 after a reply that never arrived: the account is this phone's if its own login token reads back its own header.
  private fun createdEarlier(t: SyncTransport, login: ByteArray): Long? = try {
    val page = t.pull(login, store.syncMeta().lastRev)
    page.headerRev.takeIf { Header.fromJson(page.header) == header() }
  } catch (e: SyncAuthError) {
    null
  }

  // Null on a fresh phone. Otherwise the server's vault must be this one, with settings no weaker and a history no older.
  private fun localFor(s: SignedIn, remote: Header): Header? {
    if (store.header() == null) return null
    val local = header()
    check(vault.opensWith(s.vaultKey)) { "different vault" }
    if (remote.kdf.weakerThan(local.kdf)) throw KdfOutOfRange(remote.kdf)
    if (s.headerRev < store.syncMeta().headerRev) throw SyncRollbackError()
    return local
  }

  // A fresh phone takes it all in one write, with the key-check record unlockWithKey needs (an orphan from a setUp that never wrote its header is replaced); a phone with a vault takes the header and lets syncOnce merge.
  private fun commit(s: SignedIn, h: Header, headerRev: Long, local: Header?) {
    if (local == null) {
      val orphans = store.all()
      val check = Adopt(KEY_CHECK_ID, VaultFormat.sealEntry(s.vaultKey, KEY_CHECK_ID, Entry.Deleted(clock())), 0, orphans[KEY_CHECK_ID])
      val records = s.records.map { Adopt(it.id, it.sealed, it.rev, orphans[it.id]) } + check
      store.applyPull(PullApplied(h, headerRev, records, s.quarantine, emptyList(), s.lastRev))
    } else {
      commitHeader(h, headerRev)
    }
    check(vault.unlockWithKey(s.vaultKey)) { "different vault" }
  }

  // A Keystore key the system invalidated can't seal; an owner's sign-in starts the secrets over (what that key sealed is unreadable already) and stores the full set again.
  private fun storeAll(values: List<Pair<SyncSecret, ByteArray>>) {
    try {
      for ((s, v) in values) secrets.put(s, v)
    } catch (e: IllegalStateException) {
      if (e.message != KEY_LOST) throw e
      secrets.reset()
      for ((s, v) in values) secrets.put(s, v)
    }
  }

  private fun signedIn(skipped: Int) {
    secrets.delete(SyncSecret.NEXT_LOGIN)
    secrets.delete(SyncSecret.NEXT_READ)
    update { SyncState(mode = SyncMode.ON, lastSyncAt = it.lastSyncAt, blocked = skipped) }
  }
}

private fun Opened.wipe() {
  vaultKey.fill(0)
  loginToken.fill(0)
  readToken.fill(0)
}

private fun SignedIn.wipe() {
  vaultKey.fill(0)
  loginToken.fill(0)
  readToken?.fill(0)
}

private fun ByteArray?.sameKey(k: ByteArray) = this != null && try {
  MessageDigest.isEqual(this, k)
} finally {
  fill(0)
}

private fun fingerprint(headerJson: String) = Crypto.tokenHash(Crypto.utf8(headerJson))

private fun hashOf(token: ByteArray) = try {
  Crypto.tokenHash(token)
} finally {
  token.fill(0)
}
