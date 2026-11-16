package expo.modules.strongroomvault.core

import java.security.MessageDigest

// keyUnseen: an enrol rotated the recovery key and the owner hasn't confirmed seeing the new one (a crash mid-PUT loses it).
data class RecoveryLocal(
  val escrowCodeHash: String? = null, // only a hash: storage plus the inbox must never open the escrow without the wait
  val confirmed: Boolean = false,
  val lostClaim: String? = null,
  val lostBlob: String? = null,
  val keyUnseen: Boolean = false,
)

sealed interface LostState {
  object None : LostState

  data class Waiting(val releaseAt: Long?) : LostState

  object Ready : LostState
}

interface RecoverySettings {
  fun load(): RecoveryLocal

  fun save(r: RecoveryLocal)
}

data class PendingRecovery(val releaseAt: Long?)

data class EmailRecoveryStatus(
  val available: Boolean,
  val checked: Boolean, // false: the server couldn't be asked, and the other fields mean nothing
  val enrolled: Boolean,
  val waitingForCode: Boolean,
  val pendingRecovery: PendingRecovery?,
  val wasTurnedOff: Boolean,
  val keyUnseen: Boolean, // local, so set whatever checked says
)

private const val MAX_EMAIL = 320
private val EMAIL = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$") // the Worker's escrowOf check
private const val CLAIM_BYTES = 20

class EmailRecovery(
  private val sync: SyncSession,
  private val secrets: SyncSecrets,
  private val settings: RecoverySettings,
  private val transport: SyncTransport?,
) {
  /** Null for a wrong password. The code's hash is saved after the rotated header and before the PUT, so a run cut short leaves a hash that [status] drops. */
  @Synchronized fun enrol(email: String, password: CharArray): Enrolment? {
    val clean = email.trim()
    require(clean.length <= MAX_EMAIL && EMAIL.matches(clean)) { "bad email" }
    val ak = secrets.get(SyncSecret.ACCOUNT_KEY) ?: throw IllegalStateException("sync off")
    val code = RecoveryKey.generate()
    val before = settings.load()
    settings.save(before.copy(keyUnseen = true)) // before the header write, so a kill right after it still warns
    try {
      return sync.enrolEscrow(password) { rk ->
        settings.save(before.copy(escrowCodeHash = Crypto.tokenHash(code), confirmed = false, keyUnseen = true))
        EscrowBody(clean, SyncWire.toBase64(Escrow.seal(code, rk, ak)), RecoveryKey.format(code))
      }.also { if (it == null) settings.save(before) } // a wrong password: nothing rotated
    } catch (e: Exception) {
      settings.save(before) // a refusal left the server's escrow, and so this phone's state, as they were
      if (e is SyncHttpError && e.status == 502) throw IllegalStateException("mail failed", e)
      if (e is SyncHttpError && e.status == 409) throw IllegalStateException("vault moved", e)
      throw e
    } finally {
      code.fill(0)
      ak.fill(0)
    }
  }

  @Synchronized fun confirm(codeText: String): Boolean {
    val r = settings.load()
    val expected = r.escrowCodeHash ?: throw IllegalStateException("not waiting")
    val code = RecoveryKey.parse(codeText) ?: return false
    val typed = try {
      Crypto.tokenHash(code)
    } finally {
      code.fill(0)
    }
    if (!MessageDigest.isEqual(Crypto.utf8(typed), Crypto.utf8(expected))) return false
    settings.save(r.copy(escrowCodeHash = null, confirmed = true))
    return true
  }

  @Synchronized fun turnOff() {
    val t = transport?.takeIf { sync.isOn } ?: throw IllegalStateException("sync off")
    val token = secrets.get(SyncSecret.LOGIN_TOKEN) ?: throw IllegalStateException("sync off")
    try {
      t.deleteEscrow(token)
    } finally {
      token.fill(0)
    }
    settings.save(RecoveryLocal(keyUnseen = settings.load().keyUnseen)) // the Worker drops any lost-access request with the escrow
  }

  @Synchronized fun keyShown() = settings.save(settings.load().copy(keyUnseen = false))

  /** The network call runs outside this object's monitor, so keyShown, confirm and enrol never wait on it; still call it off the main thread (Dispatchers.IO). */
  fun status(): EmailRecoveryStatus {
    val read = synchronized(this) { settings.load() }
    val unchecked = EmailRecoveryStatus(transport != null, false, false, false, null, false, read.keyUnseen)
    val t = transport?.takeIf { sync.isOn } ?: return unchecked
    val remote = try {
      val token = secrets.get(SyncSecret.READ_TOKEN) ?: return unchecked
      try {
        t.lostStatus(token)
      } finally {
        token.fill(0)
      }
    } catch (e: Exception) {
      return unchecked // offline, a server error, a refused token or a locked Keystore: never an error
    }
    synchronized(this) {
      var r = settings.load()
      // No server escrow, so no code was mailed for this hash; dropped only if nothing changed while the question was out (accepted edge cases: Task 3's notes in the plan).
      if (r == read && r.escrowCodeHash != null && !r.confirmed && !remote.escrow) r = r.copy(escrowCodeHash = null).also(settings::save)
      val waiting = r.escrowCodeHash != null && !r.confirmed
      return EmailRecoveryStatus(true, true, remote.escrow && !waiting, waiting, if (remote.pending) PendingRecovery(remote.releaseAt) else null, r.confirmed && !remote.escrow, r.keyUnseen)
    }
  }

  /** No account, token or unlocked vault needed. One claim, saved before the call and resent as is (the Worker ignores one it holds), so a lost reply never orphans the mailed link. */
  @Synchronized fun lostRequest() {
    val t = transport ?: throw IllegalStateException("sync unavailable")
    val r = settings.load()
    val stored = r.lostClaim
    if (stored != null) {
      val alive = when (val s = t.lostRelease(stored)) {
        is LostRelease.Ready -> true
        is LostRelease.Waiting -> s.releaseAt != null
      }
      if (alive) throw IllegalStateException("request alive")
    }
    val claim = stored?.let(SyncWire::fromBase64) ?: Crypto.randomBytes(CLAIM_BYTES).also { settings.save(r.copy(lostClaim = SyncWire.toBase64(it), lostBlob = null)) }
    try {
      t.lostRequest(Crypto.tokenHash(claim))
    } finally {
      claim.fill(0)
    }
  }

  /** Waiting(null) also means a claim the Worker doesn't hold (never arrived, cancelled, replaced, dropped with the escrow); [lostRequest] sends it again. */
  @Synchronized fun lostCheck(): LostState {
    val r = settings.load()
    val claim = r.lostClaim ?: return LostState.None
    val t = transport ?: throw IllegalStateException("sync unavailable")
    return when (val s = t.lostRelease(claim)) {
      is LostRelease.Ready -> LostState.Ready.also { settings.save(r.copy(lostBlob = s.blob)) }
      is LostRelease.Waiting -> LostState.Waiting(s.releaseAt).also { if (r.lostBlob != null) settings.save(r.copy(lostBlob = null)) } // the server's answer wins over a blob in hand
    }
  }

  @Synchronized fun lostOpen(codeText: String, newPassword: CharArray): Boolean {
    val blob = settings.load().lostBlob?.let(SyncWire::fromBase64) ?: throw IllegalStateException("not ready")
    val code = RecoveryKey.parse(codeText) ?: return false
    val keys = try {
      Escrow.open(code, blob)
    } finally {
      code.fill(0)
    } ?: return false
    try {
      val held = secrets.get(SyncSecret.ACCOUNT_KEY)
      if (held != null) check(held.sameAs(keys.accountKey)) { "different account" } // recover would take the Keystore's key over the opened one
      sync.recover(keys.recoveryKey, newPassword, keys.accountKey)
    } finally {
      keys.recoveryKey.fill(0)
      keys.accountKey.fill(0)
    }
    try {
      val token = secrets.get(SyncSecret.READ_TOKEN)
      try {
        if (token != null) transport?.lostCancel(token)
      } finally {
        token?.fill(0)
      }
    } catch (e: Exception) {
      // Best effort: the used request would otherwise read as pending on this vault's own screen, where the owner can still cancel it.
    }
    clearLost()
    return true
  }

  /** After the owner got in another way; the Worker's row, if any, is left for the vault screen to show and cancel. */
  @Synchronized fun clearLost() {
    val r = settings.load()
    if (r.lostClaim != null || r.lostBlob != null) settings.save(r.copy(lostClaim = null, lostBlob = null))
  }

  @Synchronized fun cancelLost() {
    val t = transport?.takeIf { sync.isOn } ?: throw IllegalStateException("sync off")
    val token = secrets.get(SyncSecret.READ_TOKEN) ?: throw IllegalStateException("sync off")
    try {
      t.lostCancel(token)
    } finally {
      token.fill(0)
    }
  }
}

private fun ByteArray.sameAs(other: ByteArray) = try {
  MessageDigest.isEqual(this, other)
} finally {
  fill(0)
}
