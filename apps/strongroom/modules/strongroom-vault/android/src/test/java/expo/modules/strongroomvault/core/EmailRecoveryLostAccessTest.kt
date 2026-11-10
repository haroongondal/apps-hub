package expo.modules.strongroomvault.core

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class EmailRecoveryLostAccessTest {
  private val fast = KdfParams(1024, 1, 1)
  private val password = "correct horse battery staple".toCharArray()
  private val newPassword = "a brand new master password".toCharArray()
  private val recoveryKey = ByteArray(20) { (it + 1).toByte() }
  private val hour = 3_600_000L
  private val day = 24 * hour
  private val w = FakeWorker()

  // The network between a phone and the Worker: the next call can fail before it reaches the Worker, or after (a lost reply).
  private var onPut: (() -> Unit)? = null
  private var putBefore: Throwable? = null
  private var putAfter: Throwable? = null
  private var requestBefore: Throwable? = null
  private var requestAfter: Throwable? = null
  private val net = object : SyncTransport by w.t {
    override fun putAccount(token: ByteArray, body: AccountUpdate): Long {
      onPut?.let {
        onPut = null
        it()
      }
      putBefore?.let {
        putBefore = null
        throw it
      }
      return w.t.putAccount(token, body).also { putAfter?.let { putAfter = null; throw it } }
    }

    override fun lostRequest(claimHash: String) {
      requestBefore?.let {
        requestBefore = null
        throw it
      }
      w.t.lostRequest(claimHash)
      requestAfter?.let {
        requestAfter = null
        throw it
      }
    }
  }

  @Before fun lowerKdfFloor() {
    KdfParams.testFloor = fast
  }

  @After fun clearKdfFloor() {
    KdfParams.testFloor = null
  }

  private fun refused(message: String, block: () -> Unit) =
    assertEquals(message, assertThrows(IllegalStateException::class.java) { block() }.message)

  private class Enrolled(val p: TestPhone, val ak: ByteArray, val code: String)

  private fun enrolled(vararg names: String): Enrolled {
    val p = TestPhone(net)
    p.vault.setUp(password, recoveryKey, fast)
    for (n in names) p.vault.put(null, testLogin(n))
    val ak = p.session.enable(SETUP_TOKEN, password, recoveryKey)!!
    p.recovery.enrol("me@example.com", password)!!
    p.recovery.keyShown()
    val code = w.mails.single()
    assertTrue(p.recovery.confirm(code))
    return Enrolled(p, ak, code)
  }

  private fun later(ms: Long, vararg phones: TestPhone) {
    w.time += ms
    for (p in phones) p.time += ms
  }

  private fun TestPhone.claimHash() = Crypto.tokenHash(SyncWire.fromBase64(recoverySettings.state.lostClaim!!)!!)

  private fun TestPhone.readyToOpen() {
    recovery.lostRequest()
    w.confirmLost()
    later(day, this)
    assertEquals(LostState.Ready, recovery.lostCheck())
  }

  @Test fun requestStoresAClaimAndTheServerSeesItsHash() {
    enrolled()
    val q = TestPhone(net)
    w.calls.clear()
    assertEquals(LostState.None, q.recovery.lostCheck())
    assertTrue(w.calls.isEmpty())
    q.recovery.lostRequest()
    val s = q.recoverySettings.state
    assertEquals(20, SyncWire.fromBase64(s.lostClaim!!)!!.size)
    assertEquals(q.claimHash(), w.lost!!.claimHash)
    assertEquals(q.time, s.lostRequestedAt)
    assertNull(s.lostBlob)
    assertEquals(listOf("lostRequest"), w.calls) // no stored claim, so nothing to ask about first
    assertEquals(LostState.Waiting(null), q.recovery.lostCheck())
  }

  @Test fun requestWorksWithSyncOffLockedOrWithoutAnAccount() {
    val e = enrolled("Bank")
    val off = TestPhone(net).also {
      it.vault.setUp(password, recoveryKey, fast) // its own vault, sync never turned on
      it.vault.lock()
    }
    off.recovery.lostRequest()
    assertEquals(off.claimHash(), w.lost!!.claimHash)

    w.loginHash = "changed on another device"
    assertThrows(SyncAuthError::class.java) { e.p.session.sync() }
    e.p.vault.lock()
    later(hour) // the Worker takes a new claim an hour after the last
    e.p.recovery.lostRequest()
    assertEquals(e.p.claimHash(), w.lost!!.claimHash)
    assertEquals(SyncMode.NEEDS_SIGN_IN, e.p.settings.state.mode)

    val nowhere = TestPhone(null)
    assertEquals(LostState.None, nowhere.recovery.lostCheck())
    refused("sync unavailable") { nowhere.recovery.lostRequest() }
  }

  @Test fun aSecondRequestIsRefusedWhileOneIsAliveWhateverTheScreenSays() {
    enrolled()
    val q = TestPhone(net)
    q.recovery.lostRequest()
    val first = q.recoverySettings.state
    val held = w.lost!!.claimHash
    w.confirmLost()
    later(2 * hour, q) // past the cooldown, so only the server's answer can refuse it
    w.calls.clear()
    refused("request alive") { q.recovery.lostRequest() }
    assertEquals(listOf("lostRelease"), w.calls)
    later(day, q)
    refused("request alive") { q.recovery.lostRequest() } // ready
    q.recoverySettings.state = first.copy(lostRequestedAt = null) // a stale or damaged local record changes nothing
    refused("request alive") { q.recovery.lostRequest() }
    later(8 * day, q)
    refused("request alive") { q.recovery.lostRequest() } // past the grace, but nobody replaced it: still ready
    assertEquals(first.copy(lostRequestedAt = null), q.recoverySettings.state)
    assertEquals(held, w.lost!!.claimHash)
    assertEquals(LostState.Ready, q.recovery.lostCheck())
  }

  @Test fun anUnconfirmedRequestIsKeptForAnHourThenReplaced() {
    enrolled()
    val q = TestPhone(net)
    q.recovery.lostRequest()
    val first = q.recoverySettings.state
    val held = w.lost
    w.calls.clear()
    refused("request alive") { q.recovery.lostRequest() } // the Worker would ignore it yet answer ok, leaving the phone on a claim it never recorded
    later(hour - 1, q)
    refused("request alive") { q.recovery.lostRequest() }
    assertTrue(w.calls.isEmpty())
    assertEquals(first, q.recoverySettings.state)
    assertEquals(held, w.lost)

    later(1, q)
    q.recovery.lostRequest()
    assertNotEquals(first.lostClaim, q.recoverySettings.state.lostClaim)
    assertEquals(q.claimHash(), w.lost!!.claimHash) // the phone and the Worker agree on the new claim
    assertEquals(q.time, q.recoverySettings.state.lostRequestedAt)
    w.confirmLost()
    later(day, q)
    assertEquals(LostState.Ready, q.recovery.lostCheck())
  }

  @Test fun aFailedRequestKeepsTheOldClaim() {
    enrolled()
    val q = TestPhone(net)
    q.recovery.lostRequest()
    later(hour, q)
    val first = q.recoverySettings.state
    val held = w.lost
    w.offline = true
    assertThrows(SyncOfflineError::class.java) { q.recovery.lostRequest() }
    w.offline = false
    requestBefore = SyncHttpError(503)
    assertThrows(SyncHttpError::class.java) { q.recovery.lostRequest() }
    assertEquals(first, q.recoverySettings.state)
    assertEquals(held, w.lost)

    requestAfter = SyncOfflineError() // the Worker took it and the reply was lost: the phone can't know, so it keeps what it had
    assertThrows(SyncOfflineError::class.java) { q.recovery.lostRequest() }
    assertEquals(first, q.recoverySettings.state)
    assertNotEquals(held, w.lost)
    later(hour, q) // that unknown claim is never confirmed, so an hour later a new request replaces it
    q.recovery.lostRequest()
    assertEquals(q.claimHash(), w.lost!!.claimHash)
  }

  @Test fun checkIsWaitingUntilReleaseThenReadyAndStoresTheBlob() {
    enrolled()
    val q = TestPhone(net)
    q.recovery.lostRequest()
    assertEquals(LostState.Waiting(null), q.recovery.lostCheck())
    val at = w.time + day
    w.confirmLost(at)
    assertEquals(LostState.Waiting(at), q.recovery.lostCheck())
    later(day - 1, q)
    assertEquals(LostState.Waiting(at), q.recovery.lostCheck())
    assertNull(q.recoverySettings.state.lostBlob)
    later(1, q)
    assertEquals(LostState.Ready, q.recovery.lostCheck())
    assertEquals(w.escrow!!.blob, q.recoverySettings.state.lostBlob)
    assertEquals(LostState.Ready, q.recovery.lostCheck())
  }

  @Test fun openWithTheMailedCodeRecoversTheVaultAndClearsClaimAndBlob() {
    val e = enrolled("Bank", "Mail")
    val recoveryHash = w.recoveryHash
    val escrow = w.escrow
    val q = TestPhone(net) // a new phone: no vault, no account
    q.readyToOpen()
    val typed = " " + e.code.replace("-", "").lowercase().chunked(8).joinToString(" ") + " " // Review Focus 2
    assertTrue(q.recovery.lostOpen(typed, newPassword))
    assertEquals(RecoveryLocal(), q.recoverySettings.state)
    assertEquals(listOf("Bank", "Mail"), q.names().sorted())
    assertEquals(SyncMode.ON, q.settings.state.mode)
    assertArrayEquals(e.ak, q.secrets.get(SyncSecret.ACCOUNT_KEY))
    assertEquals(q.store.header(), w.header)
    assertEquals(recoveryHash, w.recoveryHash) // only the master password changed
    assertEquals(escrow, w.escrow) // email recovery stays on
    q.vault.lock()
    assertFalse(q.vault.unlock(password))
    assertTrue(q.vault.unlock(newPassword))
  }

  @Test fun theLockedPhoneThatEnrolledRecoversItsOwnVault() {
    val e = enrolled("Bank")
    val recoveryHash = w.recoveryHash
    e.p.vault.lock()
    e.p.readyToOpen()
    assertTrue(e.p.recovery.lostOpen(e.code, newPassword))
    assertTrue(e.p.vault.isUnlocked)
    assertEquals(listOf("Bank"), e.p.names())
    assertEquals(RecoveryLocal(confirmed = true), e.p.recoverySettings.state)
    assertEquals(recoveryHash, w.recoveryHash)
    e.p.session.sync()
    e.p.vault.lock()
    assertTrue(e.p.vault.unlock(newPassword))
  }

  @Test fun openWithAWrongCodeChangesNothing() {
    val e = enrolled("Bank")
    val q = TestPhone(net)
    refused("not ready") { q.recovery.lostOpen(e.code, newPassword) }
    q.recovery.lostRequest()
    refused("not ready") { q.recovery.lostOpen(e.code, newPassword) }
    w.confirmLost()
    later(day, q)
    assertEquals(LostState.Ready, q.recovery.lostCheck())
    val ready = q.recoverySettings.state
    w.calls.clear()
    assertFalse(q.recovery.lostOpen(RecoveryKey.format(RecoveryKey.generate()), newPassword))
    assertFalse(q.recovery.lostOpen("not a code", newPassword))
    assertFalse(q.recovery.lostOpen("", newPassword))
    assertEquals(ready, q.recoverySettings.state)
    assertTrue(w.calls.isEmpty())
    assertNull(q.store.header())
  }

  @Test fun openRefusesADifferentAccountKey() {
    val e = enrolled("Bank")
    val q = TestPhone(net)
    val other = ByteArray(20) { 7 }
    q.secrets.put(SyncSecret.ACCOUNT_KEY, other) // this phone belongs to another account
    q.readyToOpen()
    val ready = q.recoverySettings.state
    val header = w.header
    w.calls.clear()
    refused("different account") { q.recovery.lostOpen(e.code, newPassword) }
    assertEquals(ready, q.recoverySettings.state)
    assertTrue(w.calls.isEmpty())
    assertEquals(header, w.header)
    assertArrayEquals(other, q.secrets.get(SyncSecret.ACCOUNT_KEY))
    assertNull(q.store.header())
  }

  @Test fun aFailedRecoverKeepsClaimAndBlobSoTheOwnerCanRetry() {
    val e = enrolled("Bank")
    val q = TestPhone(net)
    q.readyToOpen()
    val ready = q.recoverySettings.state
    w.offline = true
    assertThrows(SyncOfflineError::class.java) { q.recovery.lostOpen(e.code, newPassword) }
    w.offline = false
    putBefore = SyncHttpError(503)
    assertThrows(SyncHttpError::class.java) { q.recovery.lostOpen(e.code, newPassword) }
    putAfter = SyncOfflineError() // the Worker took the new password and the reply was lost
    assertThrows(SyncOfflineError::class.java) { q.recovery.lostOpen(e.code, newPassword) }
    assertEquals(ready, q.recoverySettings.state)
    assertNull(q.store.header())
    assertTrue(q.recovery.lostOpen(e.code, newPassword)) // the recovery key still signs in, so the retry finishes it
    assertEquals(RecoveryLocal(), q.recoverySettings.state)
    assertEquals(listOf("Bank"), q.names())
  }

  @Test fun aBlobForARotatedRecoveryKeyFailsAndTheNextCheckDropsIt() {
    val e = enrolled("Bank")
    val q = TestPhone(net)
    q.readyToOpen()
    e.p.session.newRecoveryKey(password)!!
    e.p.session.sync() // the Worker drops the escrow and the request with the old recovery key
    val ready = q.recoverySettings.state
    assertThrows(SyncAuthError::class.java) { q.recovery.lostOpen(e.code, newPassword) }
    assertEquals(ready, q.recoverySettings.state)
    assertNull(q.store.header())
    assertEquals(LostState.Waiting(null), q.recovery.lostCheck())
    assertNull(q.recoverySettings.state.lostBlob) // the server's answer wins over the blob in hand
    refused("not ready") { q.recovery.lostOpen(e.code, newPassword) }
  }

  @Test fun aClaimTheServerNoLongerHoldsWaitsWithNoTimeAndCanBeReplacedAfterAnHour() {
    val e = enrolled()
    val q = TestPhone(net)
    q.readyToOpen()
    later(8 * day, q)
    assertEquals(LostState.Ready, q.recovery.lostCheck()) // the grace alone ends nothing
    TestPhone(net).recovery.lostRequest() // anyone's request replaces it once the grace is over
    assertEquals(LostState.Waiting(null), q.recovery.lostCheck())
    assertNull(q.recoverySettings.state.lostBlob)
    refused("not ready") { q.recovery.lostOpen(e.code, newPassword) }

    q.recovery.lostRequest() // over an hour old here, but the Worker still ignores it: the stranger's claim is younger than an hour
    assertNotEquals(q.claimHash(), w.lost!!.claimHash)
    assertEquals(LostState.Waiting(null), q.recovery.lostCheck())
    refused("request alive") { q.recovery.lostRequest() }
    later(hour, q)
    q.recovery.lostRequest()
    assertEquals(q.claimHash(), w.lost!!.claimHash)
  }

  @Test fun cancelFromTheOwnersPhoneStopsTheWait() {
    val e = enrolled()
    val q = TestPhone(net)
    q.recovery.lostRequest()
    w.confirmLost()
    val at = w.lost!!.confirmedReleaseAt
    assertEquals(LostState.Waiting(at), q.recovery.lostCheck())
    w.calls.clear()
    e.p.recovery.cancelLost()
    assertEquals(listOf("lostCancel read"), w.calls)
    assertTrue(w.lost!!.cancelled)
    later(day, q)
    assertEquals(LostState.Waiting(null), q.recovery.lostCheck()) // never ready after a cancel
    refused("not ready") { q.recovery.lostOpen(e.code, newPassword) }
    q.recovery.lostRequest() // its claim is over an hour old and dead, so a new one may go
    assertEquals(q.claimHash(), w.lost!!.claimHash)
    assertFalse(w.lost!!.cancelled)
  }

  @Test fun cancelAfterReleaseDropsTheBlobAtTheNextCheck() {
    val e = enrolled()
    val q = TestPhone(net)
    q.readyToOpen()
    e.p.recovery.cancelLost()
    assertEquals(LostState.Waiting(null), q.recovery.lostCheck())
    assertNull(q.recoverySettings.state.lostBlob)
    refused("not ready") { q.recovery.lostOpen(e.code, newPassword) }
  }

  @Test fun cancelNeedsSyncOnAndMakesNoCallOtherwise() {
    val e = enrolled()
    w.loginHash = "changed on another device"
    assertThrows(SyncAuthError::class.java) { e.p.session.sync() }
    val fresh = TestPhone(net)
    w.calls.clear()
    refused("sync off") { e.p.recovery.cancelLost() }
    refused("sync off") { fresh.recovery.cancelLost() }
    refused("sync off") { TestPhone(null).recovery.cancelLost() }
    assertTrue(w.calls.isEmpty())
  }

  @Test fun doubleOpenIsSerialized() {
    val e = enrolled("Bank")
    val q = TestPhone(net)
    q.readyToOpen()
    var second: Throwable? = null
    val tap = Thread { second = runCatching { q.recovery.lostOpen(e.code, newPassword) }.exceptionOrNull() }
    onPut = {
      tap.start()
      tap.join(300)
      assertTrue(tap.isAlive) // the second tap waits for the first to finish
    }
    w.calls.clear()
    assertTrue(q.recovery.lostOpen(e.code, newPassword))
    tap.join()
    assertEquals("not ready", (second as IllegalStateException).message)
    assertEquals(1, w.calls.count { it.startsWith("update") })
    refused("not ready") { q.recovery.lostOpen(e.code, newPassword) }
  }
}
