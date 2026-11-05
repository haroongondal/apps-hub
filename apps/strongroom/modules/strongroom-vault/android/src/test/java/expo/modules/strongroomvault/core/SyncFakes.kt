package expo.modules.strongroomvault.core

internal const val SETUP_TOKEN = "a-setup-token-of-at-least-32-characters"

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
      if (body.ifRev != headerRev) throw SyncHttpError(409)
      header = body.header
      loginHash = body.loginHash
      readHash = body.readHash
      body.recoveryHash?.let { recoveryHash = it }
      return ++headerRev
    }
  }
}

internal class MemorySecrets : SyncSecrets {
  val values = HashMap<SyncSecret, ByteArray>()
  var keyLost = false // as a Keystore key the system invalidated: nothing it sealed opens, and it seals nothing new
  var resets = 0

  override fun get(s: SyncSecret) = if (keyLost) null else values[s]?.copyOf()

  override fun put(s: SyncSecret, value: ByteArray) {
    check(!keyLost) { "sync key lost" }
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

  override fun load() = state

  override fun save(s: SyncState) {
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
