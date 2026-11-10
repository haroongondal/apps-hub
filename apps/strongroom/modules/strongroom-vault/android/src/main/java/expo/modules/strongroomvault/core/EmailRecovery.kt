package expo.modules.strongroomvault.core

// keyUnseen: an enrol rotated the recovery key and the owner hasn't confirmed seeing the new one (a crash mid-PUT loses it).
data class RecoveryLocal(
  val escrowBlob: String? = null,
  val confirmed: Boolean = false,
  val lostClaim: String? = null,
  val lostBlob: String? = null,
  val keyUnseen: Boolean = false,
)

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

class EmailRecovery(
  private val sync: SyncSession,
  private val secrets: SyncSecrets,
  private val settings: RecoverySettings,
  private val transport: SyncTransport?,
  private val clock: () -> Long,
) {
  /** Null for a wrong password. The blob is saved after the rotated header and before the PUT, so a run cut short leaves a blob that [status] drops. */
  @Synchronized fun enrol(email: String, password: CharArray): Enrolment? {
    val clean = email.trim()
    require(clean.length <= MAX_EMAIL && EMAIL.matches(clean)) { "bad email" }
    val ak = secrets.get(SyncSecret.ACCOUNT_KEY) ?: throw IllegalStateException("sync off")
    val code = RecoveryKey.generate()
    val before = settings.load()
    try {
      return sync.enrolEscrow(password) { rk ->
        val blob = SyncWire.toBase64(Escrow.seal(code, rk, ak))
        settings.save(before.copy(escrowBlob = blob, confirmed = false, keyUnseen = true))
        EscrowBody(clean, blob, RecoveryKey.format(code))
      }
    } catch (e: Exception) {
      settings.save(before) // a refusal left the server's escrow, and so this phone's state, as they were
      throw e
    } finally {
      code.fill(0)
      ak.fill(0)
    }
  }

  @Synchronized fun confirm(codeText: String): Boolean {
    val r = settings.load()
    val blob = r.escrowBlob ?: throw IllegalStateException("not waiting")
    val code = RecoveryKey.parse(codeText) ?: return false
    val keys = try {
      Escrow.open(code, SyncWire.fromBase64(blob) ?: return false)
    } finally {
      code.fill(0)
    } ?: return false
    keys.recoveryKey.fill(0)
    keys.accountKey.fill(0)
    settings.save(r.copy(escrowBlob = null, confirmed = true)) // storage plus the code must never open anything
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

  /** Holds this object's monitor across a network call, so call it off the main thread (Dispatchers.IO). */
  @Synchronized fun status(): EmailRecoveryStatus {
    var r = settings.load()
    val unchecked = EmailRecoveryStatus(transport != null, false, false, false, null, false, r.keyUnseen)
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
    // No server escrow, so no mailed code for this blob. Accepted edge cases: a reply that timed out while the Worker was still mailing then wrote reads as enrolled
    // with no confirm; an older escrow still held while a re-enrol never landed reads as waiting for the code until the next sync sends the rotation and drops it.
    if (r.escrowBlob != null && !r.confirmed && !remote.escrow) r = r.copy(escrowBlob = null).also(settings::save)
    val waiting = r.escrowBlob != null && !r.confirmed
    return EmailRecoveryStatus(true, true, remote.escrow && !waiting, waiting, if (remote.pending) PendingRecovery(remote.releaseAt) else null, r.confirmed && !remote.escrow, r.keyUnseen)
  }
}
