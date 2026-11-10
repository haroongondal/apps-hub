package expo.modules.strongroomvault.core

internal const val SETUP_TOKEN = "a-setup-token-of-at-least-32-characters"

internal data class FakeEscrow(val email: String, val blob: String, val code: String)

/** The Worker's one lost-access row: confirmedReleaseAt stays null until the owner opens the mailed link. */
internal data class FakeLost(val claimHash: String, val requestedAt: Long, val confirmedReleaseAt: Long? = null, val cancelled: Boolean = false)

/** The vault-api Worker's rules in memory: one account, created once with the setup token; token hashes; ifRev; one global rev counter. */
internal class FakeWorker {
  var header: String? = null
  var headerRev = 0L
  var loginHash = ""
  var recoveryHash = ""
  var readHash = ""
  val rows = LinkedHashMap<String, WireRecord>()
  var latestRev = 0L
  val calls = ArrayList<String>()
  var offline = false
  var time = 1_800_000_000_000L // the Worker's clock, for lost-access cooldowns and releases
  var escrow: FakeEscrow? = null
  val mails = ArrayList<String>() // the email codes the Worker mailed
  var failMail = false // the mailer is down: an escrow update answers 502 before changing anything
  var lost: FakeLost? = null
  private var created = false

  private fun who(token: ByteArray) = Crypto.tokenHash(token).let { h ->
    when {
      header == null -> "refused"
      h == loginHash -> "login"
      h == recoveryHash -> "recovery"
      h == readHash -> "read"
      else -> "refused"
    }
  }

  private fun reach() {
    if (offline) throw SyncOfflineError()
  }

  private fun refuse(who: String, readOk: Boolean) {
    if (who == "refused" || (who == "read" && !readOk)) throw SyncAuthError()
  }

  /** The owner opening the mailed confirm link: starts the wait. Like the Worker, it does nothing for a missing, cancelled or already confirmed request. */
  fun confirmLost(releaseAt: Long) {
    lost = lost?.takeIf { !it.cancelled && it.confirmedReleaseAt == null }?.copy(confirmedReleaseAt = releaseAt) ?: lost
  }

  val t: SyncTransport = object : SyncTransport {
    override fun prelogin(): Prelogin? {
      reach()
      val h = header?.let(Header::fromJson) ?: return null
      return Prelogin(h.kdf, b64(h.salt), h.accountKey)
    }

    override fun pull(token: ByteArray, since: Long): PullResponse {
      reach()
      val who = who(token)
      calls += "pull $since $who"
      refuse(who, readOk = true)
      return PullResponse(header!!, headerRev, rows.values.filter { it.rev!! > since }.sortedBy { it.rev }, latestRev, false)
    }

    override fun push(token: ByteArray, req: PushRequest): PushResult {
      reach()
      val who = who(token)
      calls += "push $who " + req.upserts.joinToString(" ") { "${it.id.takeLast(2)}@${it.baseRev}" }
      refuse(who, readOk = false)
      val conflicts = req.upserts.filter { (rows[it.id]?.rev ?: 0) != it.baseRev }.map { it.id to (rows[it.id]?.rev ?: 0) }
      if (conflicts.isNotEmpty()) return PushConflict(conflicts)
      for (u in req.upserts) rows[u.id] = WireRecord(u.id, ++latestRev, u.ciphertext)
      return PushResponse(req.upserts.map { it.id to rows.getValue(it.id).rev }, latestRev)
    }

    override fun putAccount(setupToken: String, body: AccountCreate): Long {
      reach()
      calls += "create"
      if (setupToken != SETUP_TOKEN) throw SyncAuthError()
      if (created) throw SyncHttpError(403)
      created = true
      header = body.header
      loginHash = body.loginHash
      recoveryHash = body.recoveryHash
      readHash = body.readHash
      headerRev = 1
      return headerRev
    }

    override fun putAccount(token: ByteArray, body: AccountUpdate): Long {
      reach()
      val who = who(token)
      calls += "update $who ifRev=${body.ifRev}" + if (body.recoveryHash == null) "" else " recovery"
      refuse(who, readOk = false)
      val e = body.escrow
      if (e != null) {
        if (!validEscrow(e)) throw SyncHttpError(400)
        if (body.recoveryHash == null) throw SyncHttpError(400)
        if (failMail) throw SyncHttpError(502) // the Worker mails before it writes
        mails += e.code
      }
      if (body.ifRev != headerRev) throw SyncHttpError(409)
      if (body.recoveryHash != null && body.recoveryHash != recoveryHash) {
        escrow = null
        lost = null
      }
      e?.let { escrow = FakeEscrow(it.email, it.blob, it.code) }
      header = body.header
      loginHash = body.loginHash
      readHash = body.readHash
      body.recoveryHash?.let { recoveryHash = it }
      return ++headerRev
    }

    override fun lostRequest(claimHash: String) {
      reach()
      calls += "lostRequest"
      val held = lost
      val free = held == null || held.cancelled || (held.confirmedReleaseAt == null && time - held.requestedAt >= HOUR_MS) ||
        (held.confirmedReleaseAt != null && time >= held.confirmedReleaseAt + GRACE_MS)
      if (escrow != null && free && Regex("^[A-Za-z0-9+/]{43}=$").matches(claimHash)) lost = FakeLost(claimHash, time)
    }

    override fun lostRelease(claim: String): LostRelease {
      reach()
      calls += "lostRelease"
      val bytes = if (claim.length in 24..88) SyncWire.fromBase64(claim) else null
      val held = lost
      if (bytes != null && bytes.size in 16..64 && held != null && !held.cancelled && held.claimHash == Crypto.tokenHash(bytes)) {
        val at = held.confirmedReleaseAt
        val sealed = escrow
        if (at != null && time >= at && sealed != null) return LostRelease.Ready(sealed.blob)
        return LostRelease.Waiting(at)
      }
      return LostRelease.Waiting(null)
    }

    override fun lostStatus(token: ByteArray): LostStatus {
      reach()
      val who = who(token)
      calls += "lostStatus $who"
      refuse(who, readOk = true)
      val held = lost?.takeIf { !it.cancelled }
      return LostStatus(escrow != null, held != null, held?.confirmedReleaseAt)
    }

    override fun lostCancel(token: ByteArray) {
      reach()
      val who = who(token)
      calls += "lostCancel $who"
      refuse(who, readOk = true)
      lost = lost?.copy(cancelled = true)
    }

    override fun deleteEscrow(token: ByteArray) {
      reach()
      val who = who(token)
      calls += "deleteEscrow $who"
      if (who != "login") throw SyncAuthError()
      escrow = null
      lost = null
    }
  }
}

private const val HOUR_MS = 3_600_000L
private const val GRACE_MS = 7 * 24 * HOUR_MS

private fun validEscrow(e: EscrowBody) =
  e.email.length in 1..320 && Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$").matches(e.email) && SyncWire.fromBase64(e.blob) != null && e.code.length in 1..64

internal class MemorySecrets : SyncSecrets {
  val values = HashMap<SyncSecret, ByteArray>()
  var keyLost = false // as a Keystore key the system invalidated: nothing it sealed opens, and it seals nothing new
  var resets = 0
  var failOn: SyncSecret? = null // a write that fails, as a full disk would

  override fun get(s: SyncSecret) = if (keyLost) null else values[s]?.copyOf()

  override fun put(s: SyncSecret, value: ByteArray) {
    check(!keyLost) { "sync key lost" }
    check(s != failOn) { "disk full" }
    values[s] = value.copyOf()
  }

  override fun delete(s: SyncSecret) {
    values.remove(s)
  }

  override fun reset() {
    resets++
    keyLost = false
    values.clear()
  }
}

internal class MemorySettings : SyncSettings {
  var state = SyncState()
  var failSave = false

  override fun load() = state

  override fun save(s: SyncState) {
    check(!failSave) { "disk full" }
    state = s
  }
}

/** A phone as VaultHolder wires it, with memory in place of SQLite, the Keystore and SharedPreferences. */
internal class TestPhone(transport: SyncTransport?) {
  var time = 1_800_000_000_000L
  val store = MemoryRecordStore()
  val secrets = MemorySecrets()
  val settings = MemorySettings()
  val vault = Vault(store, { time }, { 0L }) { secrets.get(SyncSecret.ACCOUNT_KEY) }
  val session = SyncSession(vault, store, secrets, settings, transport) { time }

  fun header() = Header.fromJson(store.header()!!)!!

  fun names() = vault.rows().map { it.name }
}

internal fun testLogin(name: String) = Entry.Login(name, "me", "pw-$name", emptyList(), emptyList(), "", 0)
