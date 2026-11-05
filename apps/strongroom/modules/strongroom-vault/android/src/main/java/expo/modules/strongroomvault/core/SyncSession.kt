package expo.modules.strongroomvault.core

import java.security.MessageDigest

enum class SyncMode { OFF, PENDING_SETUP, ON, NEEDS_SIGN_IN }

data class SyncState(
  val mode: SyncMode = SyncMode.OFF,
  val lastSyncAt: Long? = null,
  val blocked: Int = 0,
  val quarantined: Int = 0,
  val failed: Boolean = false,
  val accountPending: Boolean = false,
  val recoveryHash: String? = null,
)

interface SyncSettings {
  fun load(): SyncState

  fun save(s: SyncState)
}

enum class SyncSecret { ACCOUNT_KEY, LOGIN_TOKEN, READ_TOKEN, PENDING_AUTH }

interface SyncSecrets {
  fun get(s: SyncSecret): ByteArray?

  fun put(s: SyncSecret, value: ByteArray)

  fun delete(s: SyncSecret)
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

  /** Null for a wrong password. Retry-safe: the key reaches the Keystore before the header that needs it, and a retry after the local commit only repeats the PUT. */
  @Synchronized fun enable(setupToken: String, password: CharArray, recoveryKey: ByteArray): ByteArray? {
    val t = server()
    check(settings.load().mode.let { it == SyncMode.OFF || it == SyncMode.PENDING_SETUP }) { "sync already on" }
    val k = vault.vaultKeyCopy(password) ?: return null
    try {
      val h = header()
      check(VaultFormat.unlockWithRecovery(h, recoveryKey).sameKey(k)) { "wrong recovery key" }
      val ak = secrets.get(SyncSecret.ACCOUNT_KEY) ?: AccountKey.generate().also { secrets.put(SyncSecret.ACCOUNT_KEY, it) }
      try {
        val flagged = if (h.accountKey) h else VaultFormat.withAccountKey(h, k, password, ak)
        val opened = VaultFormat.openWithPassword(flagged, password, ak)
        check(opened != null && opened.vaultKey.copyOf().sameKey(k))
        try {
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
          val rev = try {
            t.putAccount(setupToken, body)
          } catch (e: SyncAuthError) {
            throw IllegalStateException("wrong setup token")
          } catch (e: SyncHttpError) {
            if (e.status != 403) throw e
            createdEarlier(t, opened.loginToken) ?: throw IllegalStateException("account exists")
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
    val k = vault.vaultKeyCopy(password)
    if (k == null) ak.fill(0)
    k?.fill(0)
    return ak.takeIf { k != null }
  }

  @Synchronized fun signIn(password: CharArray, accountKey: ByteArray) {
    val t = server()
    val s = SyncClient.signInWithPassword(t, password, accountKey)
    try {
      val local = localFor(s, s.header)
      secrets.put(SyncSecret.ACCOUNT_KEY, accountKey)
      secrets.put(SyncSecret.LOGIN_TOKEN, s.loginToken)
      s.readToken?.let { secrets.put(SyncSecret.READ_TOKEN, it) }
      commit(s, s.header, s.headerRev, local)
      signedIn(s.skipped)
    } finally {
      s.wipe()
    }
  }

  @Synchronized fun recover(recoveryKey: ByteArray, newPassword: CharArray) {
    val t = server()
    val ak = secrets.get(SyncSecret.ACCOUNT_KEY) ?: throw AccountKeyRequired()
    try {
      val s = SyncClient.signInWithRecovery(t, recoveryKey)
      try {
        val local = localFor(s, s.header)
        val h = VaultFormat.withNewPassword(s.header, s.vaultKey, newPassword, accountKey = ak)
        val o = VaultFormat.openWithPassword(h, newPassword, ak) ?: error("the new header does not open")
        try {
          val rev = t.putAccount(s.loginToken, AccountUpdate(h.toJson(), Crypto.tokenHash(o.loginToken), Crypto.tokenHash(o.readToken), s.headerRev))
          secrets.put(SyncSecret.LOGIN_TOKEN, o.loginToken)
          secrets.put(SyncSecret.READ_TOKEN, o.readToken)
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
    if (settings.load().mode != SyncMode.ON) return 0
    val token = secrets.get(SyncSecret.READ_TOKEN) ?: return 0
    try {
      return recording { SyncClient.download(store, t, token) }
    } finally {
      token.fill(0)
    }
  }

  @Synchronized fun headerChanged(newPassword: CharArray?, newRecoveryKey: ByteArray?) {
    if (!isOn) return
    try {
      if (newPassword != null) {
        val ak = secrets.get(SyncSecret.ACCOUNT_KEY) ?: throw AccountKeyRequired()
        val o = try {
          VaultFormat.openWithPassword(header(), newPassword, ak) ?: error("the new header does not open")
        } finally {
          ak.fill(0)
        }
        try {
          val known = secrets.get(SyncSecret.PENDING_AUTH) ?: secrets.get(SyncSecret.LOGIN_TOKEN)
          known?.let { secrets.put(SyncSecret.PENDING_AUTH, it) }
          known?.fill(0)
          secrets.put(SyncSecret.LOGIN_TOKEN, o.loginToken)
          secrets.put(SyncSecret.READ_TOKEN, o.readToken)
        } finally {
          o.wipe()
        }
      }
      val hash = newRecoveryKey?.let { hashOf(VaultFormat.recoveryLoginToken(it)) }
      update { it.copy(accountPending = true, recoveryHash = hash ?: it.recoveryHash) }
    } catch (e: Exception) {
      update { it.copy(failed = true) }
    }
  }

  private fun server(): SyncTransport = transport ?: throw IllegalStateException("sync unavailable")

  private fun update(change: (SyncState) -> SyncState) = settings.save(change(settings.load()))

  private fun storedHeader(): String = store.header() ?: throw IllegalStateException("not set up")

  private fun header(): Header = Header.fromJson(storedHeader()) ?: throw IllegalStateException("header unreadable")

  private fun commitHeader(h: Header?, headerRev: Long) =
    store.applyPull(PullApplied(h, headerRev, emptyList(), emptyList(), emptyList(), store.syncMeta().lastRev))

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

  // A refused token asks for sign-in once and stops, never a retry loop; any other failure reads "error" until a run succeeds.
  private fun <T> recording(block: () -> T): T {
    running = true
    onChange?.invoke()
    try {
      return block()
    } catch (e: SyncAuthError) {
      secrets.delete(SyncSecret.PENDING_AUTH)
      update { it.copy(mode = SyncMode.NEEDS_SIGN_IN, accountPending = false, recoveryHash = null) }
      throw e
    } catch (e: Exception) {
      update { it.copy(failed = true) }
      throw e
    } finally {
      running = false
      onChange?.invoke()
    }
  }

  // Signed with the token the server still knows (PENDING_AUTH after a password change); ifRev is the last header this phone took from it.
  private fun updateAccount(t: SyncTransport) {
    val login = secrets.get(SyncSecret.LOGIN_TOKEN) ?: throw SyncAuthError()
    val read = secrets.get(SyncSecret.READ_TOKEN) ?: throw SyncAuthError()
    val auth = secrets.get(SyncSecret.PENDING_AUTH) ?: login.copyOf()
    try {
      val body = AccountUpdate(storedHeader(), Crypto.tokenHash(login), Crypto.tokenHash(read), store.syncMeta().headerRev, settings.load().recoveryHash)
      val rev = try {
        t.putAccount(auth, body)
      } catch (e: SyncHttpError) {
        throw if (e.status == 409) SyncAuthError() else e
      }
      commitHeader(null, rev)
      secrets.delete(SyncSecret.PENDING_AUTH)
      update { it.copy(accountPending = false, recoveryHash = null) }
    } finally {
      login.fill(0)
      read.fill(0)
      auth.fill(0)
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

  private fun signedIn(skipped: Int) {
    secrets.delete(SyncSecret.PENDING_AUTH)
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

private fun hashOf(token: ByteArray) = try {
  Crypto.tokenHash(token)
} finally {
  token.fill(0)
}
