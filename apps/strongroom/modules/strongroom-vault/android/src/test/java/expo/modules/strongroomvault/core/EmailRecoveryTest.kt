package expo.modules.strongroomvault.core

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class EmailRecoveryTest {
  private val fast = KdfParams(1024, 1, 1)
  private val password = "correct horse battery staple".toCharArray()
  private val newPassword = "a brand new master password".toCharArray()
  private val recoveryKey = ByteArray(20) { (it + 1).toByte() }
  private val email = "me@example.com"
  private val w = FakeWorker()

  // The network between the phone and the Worker: the next account update can fail before it reaches the Worker, or after (a lost reply).
  private var onPut: (() -> Unit)? = null
  private var failBefore: Throwable? = null
  private var failAfter: Throwable? = null
  private val net = object : SyncTransport by w.t {
    override fun putAccount(token: ByteArray, body: AccountUpdate): Long {
      onPut?.let {
        onPut = null
        it()
      }
      failBefore?.let {
        failBefore = null
        throw it
      }
      val rev = w.t.putAccount(token, body)
      failAfter?.let {
        failAfter = null
        throw it
      }
      return rev
    }
  }

  private class Killed : Error("the process died here")

  @Before fun lowerKdfFloor() {
    KdfParams.testFloor = fast
  }

  @After fun clearKdfFloor() {
    KdfParams.testFloor = null
  }

  private fun refused(message: String, block: () -> Unit) =
    assertEquals(message, assertThrows(IllegalStateException::class.java) { block() }.message)

  private fun syncedPhone(vararg names: String): Pair<TestPhone, ByteArray> {
    val p = TestPhone(net)
    p.vault.setUp(password, recoveryKey, fast)
    for (n in names) p.vault.put(null, testLogin(n))
    return p to p.session.enable(SETUP_TOKEN, password, recoveryKey)!!
  }

  private fun hashOf(rk: ByteArray) = Crypto.tokenHash(VaultFormat.recoveryLoginToken(rk))

  private fun opens(rk: ByteArray, h: Header) = VaultFormat.unlockWithRecovery(h, rk) != null

  private fun status(checked: Boolean = true, enrolled: Boolean = false, waiting: Boolean = false, pending: PendingRecovery? = null, turnedOff: Boolean = false, unseen: Boolean = false) =
    EmailRecoveryStatus(available = true, checked = checked, enrolled = enrolled, waitingForCode = waiting, pendingRecovery = pending, wasTurnedOff = turnedOff, keyUnseen = unseen)

  private fun TestPhone.enrolSeen(address: String = email): Enrolment = recovery.enrol(address, password)!!.also { recovery.keyShown() }

  private val unchecked = status(checked = false)

  private fun assertPutBack(p: TestPhone, header: String?, local: RecoveryLocal = RecoveryLocal()) {
    assertEquals(header, p.store.header())
    assertFalse(p.settings.state.accountPending)
    assertNull(p.settings.state.recoveryHash)
    assertNull(p.secrets.get(SyncSecret.NEXT_LOGIN))
    assertNull(p.secrets.get(SyncSecret.NEXT_READ))
    assertEquals(local, p.recoverySettings.state)
  }

  @Test fun enrolRotatesTheKeyMailsTheCodeAndSealsTheEscrow() {
    val (p, ak) = syncedPhone("Bank")
    val e = p.recovery.enrol(email, password)!!
    assertTrue(e.sent)
    val sealed = w.escrow!!
    assertEquals(listOf(sealed.code), w.mails)
    assertEquals(email, sealed.email)
    val opened = Escrow.open(RecoveryKey.parse(w.mails.single())!!, SyncWire.fromBase64(sealed.blob)!!)!!
    assertArrayEquals(e.recoveryKey, opened.recoveryKey)
    assertArrayEquals(ak, opened.accountKey)
    assertEquals(hashOf(e.recoveryKey), w.recoveryHash)
    assertEquals(p.store.header(), w.header)
    assertEquals(2, p.store.meta.headerRev)
    assertFalse(p.settings.state.accountPending)
    assertNull(p.secrets.get(SyncSecret.NEXT_LOGIN))
    assertEquals(RecoveryLocal(escrowBlob = sealed.blob, keyUnseen = true), p.recoverySettings.state)
    assertEquals(status(waiting = true, unseen = true), p.recovery.status())
    p.recovery.keyShown()
    assertEquals(RecoveryLocal(escrowBlob = sealed.blob), p.recoverySettings.state)
    assertEquals(status(waiting = true), p.recovery.status())

    assertThrows(SyncAuthError::class.java) { TestPhone(w.t).session.recover(recoveryKey, newPassword, ak) } // the old key no longer signs in
    p.vault.lock()
    assertFalse(p.vault.recover(recoveryKey, newPassword))
    assertTrue(p.vault.recover(e.recoveryKey, newPassword))
  }

  @Test fun confirmWithTheMailedCodeTurnsItOnAndDropsTheLocalBlob() {
    val (p, _) = syncedPhone()
    p.enrolSeen()
    assertTrue(p.recovery.confirm(w.mails.single()))
    assertEquals(RecoveryLocal(confirmed = true), p.recoverySettings.state)
    assertEquals(status(enrolled = true), p.recovery.status())
    refused("not waiting") { p.recovery.confirm(w.mails.single()) }
  }

  @Test fun confirmWithAWrongCodeKeepsWaiting() {
    val (p, _) = syncedPhone()
    refused("not waiting") { p.recovery.confirm(RecoveryKey.format(RecoveryKey.generate())) }
    p.enrolSeen()
    val waiting = p.recoverySettings.state
    assertFalse(p.recovery.confirm(RecoveryKey.format(RecoveryKey.generate())))
    assertFalse(p.recovery.confirm("not a code"))
    assertFalse(p.recovery.confirm(""))
    assertEquals(waiting, p.recoverySettings.state)
    assertEquals(status(waiting = true), p.recovery.status())
  }

  @Test fun confirmAcceptsLowercaseSpacedCodeWithoutDashes() {
    val (p, _) = syncedPhone()
    p.enrolSeen()
    val typed = " " + w.mails.single().replace("-", "").lowercase().chunked(8).joinToString(" ") + " "
    assertTrue(p.recovery.confirm(typed))
    assertEquals(RecoveryLocal(confirmed = true), p.recoverySettings.state)
  }

  @Test fun enrolWithAWrongPasswordChangesNothing() {
    val (p, _) = syncedPhone("Bank")
    val json = p.store.header()
    w.calls.clear()
    assertNull(p.recovery.enrol(email, newPassword))
    assertPutBack(p, json)

    w.offline = true
    assertTrue(p.session.changePassword(password, newPassword))
    assertThrows(SyncOfflineError::class.java) { p.session.sync() }
    w.offline = false
    val queued = p.store.header()
    w.calls.clear()
    assertNull(p.recovery.enrol(email, password)) // checked before the flush, so a typo makes no call
    assertEquals(queued, p.store.header())
    assertTrue(p.settings.state.accountPending)
    assertTrue(w.calls.isEmpty())
    assertTrue(w.mails.isEmpty())
    assertEquals(RecoveryLocal(), p.recoverySettings.state)
  }

  @Test fun enrolRefusesBadEmailBeforeAnyCall() {
    val (p, _) = syncedPhone()
    val json = p.store.header()
    w.calls.clear()
    for (bad in listOf("", "   ", "a".repeat(316) + "@b.co", "no-at-sign", "a@b", "two words@b.co")) {
      assertEquals("bad email", assertThrows(IllegalArgumentException::class.java) { p.recovery.enrol(bad, password) }.message)
    }
    assertPutBack(p, json)
    assertTrue(w.calls.isEmpty())
    assertTrue(p.recovery.enrol("  A@B.co ", password)!!.sent)
    assertEquals("A@B.co", w.escrow!!.email)
    val longest = "a".repeat(315) + "@b.co"
    assertTrue(p.recovery.enrol(longest, password)!!.sent)
    assertEquals(longest, w.escrow!!.email)
  }

  @Test fun enrolRefusedWhenSyncIsOffLockedOrAnUpdateIsStillQueued() {
    val off = TestPhone(net).also { it.vault.setUp(password, recoveryKey, fast) }
    val offJson = off.store.header()
    refused("sync off") { off.recovery.enrol(email, password) }
    assertPutBack(off, offJson)

    val (p, ak) = syncedPhone("Bank")
    p.vault.lock()
    val json = p.store.header()
    refused("locked") { p.recovery.enrol(email, password) }
    assertPutBack(p, json)
    assertTrue(p.vault.unlock(password))

    w.offline = true
    assertTrue(p.session.changePassword(password, newPassword))
    val queued = p.store.header()
    refused("sync first") { p.recovery.enrol(email, newPassword) } // the flush failed offline
    assertEquals(queued, p.store.header())
    assertTrue(p.settings.state.accountPending)
    assertEquals(RecoveryLocal(), p.recoverySettings.state)
    w.offline = false
    assertTrue(p.recovery.enrol(email, newPassword)!!.sent) // the flush goes first, then the enrol
    assertEquals(p.store.header(), w.header)
    p.session.sync()
    TestPhone(w.t).session.signIn(newPassword, ak) // the server's hashes are the new password's

    w.loginHash = "changed on another device"
    assertThrows(SyncAuthError::class.java) { p.session.sync() }
    val signedOut = p.store.header()
    assertThrows(SyncAuthError::class.java) { p.recovery.enrol(email, newPassword) } // as sync() answers needs sign-in
    assertEquals(signedOut, p.store.header())
  }

  @Test fun a409RestoresTheOldKeyAndTellsTheOwnerToSyncAndRetry() {
    val (p, ak) = syncedPhone("Bank")
    val first = p.enrolSeen().recoveryKey
    assertTrue(p.recovery.confirm(w.mails.single()))
    val sealed = w.escrow
    val json = p.store.header()
    val server = w.header
    w.headerRev++ // another device moved the account on after this phone last synced

    assertEquals(409, assertThrows(SyncHttpError::class.java) { p.recovery.enrol("new@example.com", password) }.status)
    assertPutBack(p, json, RecoveryLocal(confirmed = true))
    assertEquals(sealed, w.escrow)
    assertEquals(server, w.header)
    assertEquals(hashOf(first), w.recoveryHash)
    assertTrue(opens(first, p.header()))
    assertEquals(w.headerRev, p.store.meta.headerRev) // the sync after the 409 caught up
    assertEquals(status(enrolled = true), p.recovery.status())

    val second = p.recovery.enrol("new@example.com", password)!!
    assertTrue(second.sent)
    assertEquals("new@example.com", w.escrow!!.email)
    assertEquals(hashOf(second.recoveryKey), w.recoveryHash)
    TestPhone(w.t).session.recover(second.recoveryKey, newPassword, ak)
  }

  @Test fun aMailFailureRestoresTheOldKey() {
    val (p, ak) = syncedPhone("Bank")
    val json = p.store.header()
    val server = w.header
    w.failMail = true
    assertEquals(502, assertThrows(SyncHttpError::class.java) { p.recovery.enrol(email, password) }.status)
    assertPutBack(p, json)
    assertTrue(w.mails.isEmpty())
    assertNull(w.escrow)
    assertEquals(server, w.header)
    assertEquals(hashOf(recoveryKey), w.recoveryHash)

    w.failMail = false
    w.calls.clear()
    p.session.sync()
    assertFalse(w.calls.any { it.startsWith("update") })
    assertTrue(opens(recoveryKey, p.header()))
    TestPhone(w.t).session.recover(recoveryKey, newPassword, ak) // the paper key still signs in
  }

  @Test fun everyOtherDefiniteRefusalRestoresTheOldKeyToo() {
    val (p, _) = syncedPhone("Bank")
    val json = p.store.header()
    for (e in listOf(SyncHttpError(400), SyncHttpError(403), SyncHttpError(429), SyncAuthError())) {
      failBefore = e
      assertSame(e, assertThrows(SyncHttpError::class.java) { p.recovery.enrol(email, password) })
      assertPutBack(p, json)
    }
    assertEquals(SyncMode.ON, p.settings.state.mode)
    assertEquals(hashOf(recoveryKey), w.recoveryHash)
    assertTrue(p.recovery.enrol(email, password)!!.sent)
  }

  // Local-first: whatever the reply, the phone holds the key the server may now have, and the owner is shown it.
  private fun aLostReply(landed: Boolean, failure: Throwable) {
    val (p, ak) = syncedPhone("Bank")
    if (landed) failAfter = failure else failBefore = failure
    val e = p.recovery.enrol(email, password)!!
    assertFalse(e.sent)
    assertTrue(opens(e.recoveryKey, p.header()))
    assertFalse(opens(recoveryKey, p.header()))
    assertTrue(p.settings.state.accountPending)
    assertEquals(hashOf(e.recoveryKey), p.settings.state.recoveryHash)
    val blob = p.recoverySettings.state.escrowBlob!!
    assertTrue(p.recoverySettings.state.keyUnseen)
    p.recovery.keyShown()

    w.calls.clear()
    if (landed) {
      val sealed = w.escrow!!
      assertEquals(blob, sealed.blob)
      assertEquals(status(waiting = true), p.recovery.status()) // the code was mailed, so it can be typed now
      p.session.sync() // the resend's stale ifRev gets a 409, then the phone finds its own header on the server
      assertEquals("update login ifRev=1 recovery", w.calls.first { it.startsWith("update") })
      assertEquals(SyncMode.ON, p.settings.state.mode)
      assertEquals("idle", p.session.status().state)
      assertEquals(w.header, p.store.header())
      assertEquals(w.headerRev, p.store.meta.headerRev)
      assertFalse(p.settings.state.accountPending)
      assertNull(p.secrets.get(SyncSecret.NEXT_LOGIN))
      assertEquals(sealed, w.escrow)
      assertEquals(status(waiting = true), p.recovery.status())
      assertTrue(p.recovery.confirm(w.mails.single()))
      assertEquals(status(enrolled = true), p.recovery.status())
    } else {
      assertTrue(w.mails.isEmpty())
      p.session.sync()
      assertEquals("update login ifRev=1 recovery", w.calls.first())
      assertEquals(p.store.header(), w.header)
      assertFalse(p.settings.state.accountPending)
      assertNull(w.escrow)
      assertEquals(status(), p.recovery.status()) // no code was mailed, so the stale blob goes
      assertEquals(RecoveryLocal(), p.recoverySettings.state)
    }
    assertEquals(hashOf(e.recoveryKey), w.recoveryHash)
    TestPhone(w.t).session.recover(e.recoveryKey, newPassword, ak)
  }

  @Test fun aLostReplyKeepsTheNewKeyAndTheNextSyncFinishesIt() = aLostReply(landed = true, failure = SyncOfflineError())

  @Test fun anEnrolThatNeverArrivedKeepsTheNewKeyAndTheNextSyncSendsIt() = aLostReply(landed = false, failure = SyncOfflineError())

  @Test fun aServerErrorIsUnclearAndKeepsTheNewKeyToo() = aLostReply(landed = false, failure = SyncHttpError(503))

  @Test fun aLocalFailureAfterTheWorkerTookItStillShowsTheNewKey() = aLostReply(landed = true, failure = IllegalStateException("disk full"))

  @Test fun aReal409OnAQueuedUpdateStillAsksForSignIn() {
    val (a, ak) = syncedPhone("Bank")
    val b = TestPhone(w.t).also { it.session.signIn(password, ak) }
    a.session.newRecoveryKey(password)!!
    b.session.newRecoveryKey(password)!!
    b.session.sync()
    w.calls.clear()
    assertThrows(SyncAuthError::class.java) { a.session.sync() }
    assertEquals(SyncMode.NEEDS_SIGN_IN, a.settings.state.mode)
    assertEquals(2, w.calls.size)
    assertTrue(w.calls[1].startsWith("pull ")) // it looked for its own header and didn't find it
    assertTrue(a.settings.state.accountPending)
  }

  @Test fun aLostReplyOnAPasswordChangeStillAsksForSignIn() {
    val (a, ak) = syncedPhone("Bank")
    assertTrue(a.session.changePassword(password, newPassword))
    failAfter = SyncOfflineError()
    assertThrows(SyncOfflineError::class.java) { a.session.sync() }
    assertEquals(a.store.header(), w.header)
    assertThrows(SyncAuthError::class.java) { a.session.sync() } // the old login token is refused (401) before any 409
    assertEquals(SyncMode.NEEDS_SIGN_IN, a.settings.state.mode)
    a.session.signIn(newPassword, ak)
    a.session.sync()
    assertEquals("idle", a.session.status().state)
  }

  @Test fun aKeystoreFailureBeforeThePutRestoresTheOldKey() {
    val (p, ak) = syncedPhone("Bank")
    val json = p.store.header()
    w.calls.clear()
    p.secrets.failGet = SyncSecret.LOGIN_TOKEN
    refused("keystore unavailable") { p.recovery.enrol(email, password) }
    p.secrets.failGet = null
    assertPutBack(p, json)
    assertFalse(w.calls.any { it.startsWith("update") })
    p.session.sync()
    TestPhone(w.t).session.recover(recoveryKey, newPassword, ak)
  }

  @Test fun anUndoThatCannotWriteKeepsTheRotationAndShowsTheKey() {
    val (p, ak) = syncedPhone("Bank")
    onPut = { p.store.headerWriteFails = true }
    failBefore = SyncHttpError(400)
    val e = p.recovery.enrol(email, password)!!
    assertFalse(e.sent)
    p.store.headerWriteFails = false
    assertTrue(opens(e.recoveryKey, p.header()))
    assertTrue(p.settings.state.accountPending)
    assertTrue(p.recovery.status().keyUnseen)
    p.session.sync()
    assertEquals(p.store.header(), w.header)
    assertEquals(hashOf(e.recoveryKey), w.recoveryHash)
    TestPhone(w.t).session.recover(e.recoveryKey, newPassword, ak)
  }

  @Test fun aFlushThatNeedsSignInAsksForSignIn() {
    val (p, _) = syncedPhone("Bank")
    w.offline = true
    assertTrue(p.session.changePassword(password, newPassword))
    w.offline = false
    w.loginHash = "changed on another device"
    val queued = p.store.header()
    assertThrows(SyncAuthError::class.java) { p.recovery.enrol(email, newPassword) }
    assertEquals(SyncMode.NEEDS_SIGN_IN, p.settings.state.mode)
    assertEquals(queued, p.store.header())
    assertEquals(RecoveryLocal(), p.recoverySettings.state)
  }

  @Test fun enrolCutShortBeforeThePutLeavesNoWaitingForCodeWithoutAnEscrow() {
    val (p, ak) = syncedPhone("Bank")
    failBefore = Killed()
    assertThrows(Killed::class.java) { p.recovery.enrol(email, password) }
    assertNotNull(p.recoverySettings.state.escrowBlob)
    assertTrue(p.settings.state.accountPending)
    val rotated = p.store.header()

    assertEquals(status(unseen = true), p.recovery.status()) // the owner never saw the key the vault now needs
    assertEquals(RecoveryLocal(keyUnseen = true), p.recoverySettings.state)
    p.session.sync()
    assertEquals(rotated, w.header) // the rotation still goes up, without an escrow
    assertNull(w.escrow)
    assertTrue(w.mails.isEmpty())
    assertEquals(status(unseen = true), p.recovery.status())
    TestPhone(w.t).session.signIn(password, ak)
    assertTrue(p.session.newRecoveryKey(password) != null) // the remedy: a new key, shown this time
    p.recovery.keyShown()
    assertEquals(status(), p.recovery.status())
  }

  @Test fun aSecondEnrolReplacesTheEscrowAndEmail() {
    val (p, ak) = syncedPhone()
    val first = p.enrolSeen("first@example.com").recoveryKey
    assertTrue(p.recovery.confirm(w.mails.single()))
    val second = p.enrolSeen("second@example.com").recoveryKey
    assertEquals(2, w.mails.size)
    val sealed = w.escrow!!
    assertEquals("second@example.com", sealed.email)
    assertEquals(w.mails[1], sealed.code)
    assertNull(Escrow.open(RecoveryKey.parse(w.mails[0])!!, SyncWire.fromBase64(sealed.blob)!!))
    assertArrayEquals(second, Escrow.open(RecoveryKey.parse(w.mails[1])!!, SyncWire.fromBase64(sealed.blob)!!)!!.recoveryKey)
    assertFalse(opens(first, p.header()))
    assertEquals(hashOf(second), w.recoveryHash)
    assertEquals(status(waiting = true), p.recovery.status())
    assertFalse(p.recovery.confirm(w.mails[0]))
    assertTrue(p.recovery.confirm(w.mails[1]))
    assertEquals(status(enrolled = true), p.recovery.status())
    TestPhone(w.t).session.recover(second, newPassword, ak)
  }

  @Test fun turnOffDeletesTheEscrowAndClearsLocalState() {
    val (p, _) = syncedPhone()
    p.recovery.enrol(email, password)!!
    p.recovery.turnOff() // the way out of waiting for a code that never came
    assertNull(w.escrow)
    assertEquals(RecoveryLocal(keyUnseen = true), p.recoverySettings.state) // turning off doesn't make the key seen
    assertEquals(status(unseen = true), p.recovery.status())
    p.recovery.keyShown()

    p.enrolSeen()
    assertTrue(p.recovery.confirm(w.mails.last()))
    w.calls.clear()
    p.recovery.turnOff()
    assertEquals(listOf("deleteEscrow login"), w.calls)
    assertNull(w.escrow)
    assertEquals(RecoveryLocal(), p.recoverySettings.state)
    assertEquals(status(), p.recovery.status())

    w.loginHash = "changed on another device"
    assertThrows(SyncAuthError::class.java) { p.session.sync() }
    w.calls.clear()
    refused("sync off") { p.recovery.turnOff() }
    assertTrue(w.calls.isEmpty())
  }

  @Test fun statusWhenOfflineIsUncheckedNotAnError() {
    val (p, _) = syncedPhone()
    p.recovery.enrol(email, password)!!
    val waiting = p.recoverySettings.state
    val local = unchecked.copy(keyUnseen = true) // the one field that needs no server
    w.offline = true
    assertEquals(local, p.recovery.status())
    w.offline = false
    p.secrets.failGet = SyncSecret.READ_TOKEN
    assertEquals(local, p.recovery.status())
    p.secrets.failGet = null
    w.readHash = "changed on another device"
    assertEquals(local, p.recovery.status())
    assertEquals(waiting, p.recoverySettings.state) // an unanswered check deletes nothing
    assertEquals(SyncMode.ON, p.settings.state.mode)
    assertEquals("idle", p.session.status().state)
  }

  @Test fun statusMakesNoCallWhenSignInIsNeeded() {
    val (p, _) = syncedPhone()
    w.loginHash = "changed on another device"
    assertThrows(SyncAuthError::class.java) { p.session.sync() }
    w.calls.clear()
    assertEquals(unchecked, p.recovery.status())
    val off = TestPhone(w.t).also { it.vault.setUp(password, recoveryKey, fast) }
    assertEquals(unchecked, off.recovery.status())
    assertTrue(w.calls.isEmpty())
    assertEquals(unchecked.copy(available = false), TestPhone(null).recovery.status())
  }

  @Test fun newRecoveryKeyWithoutEscrowTurnsItOffOnTheServer() {
    val (p, _) = syncedPhone()
    p.enrolSeen()
    assertTrue(p.recovery.confirm(w.mails.single()))
    p.session.newRecoveryKey(password)!!
    p.session.sync()
    assertNull(w.escrow)
    assertEquals(status(turnedOff = true), p.recovery.status())
  }

  @Test fun aPendingRequestShowsInStatus() {
    val (p, _) = syncedPhone()
    p.enrolSeen()
    assertTrue(p.recovery.confirm(w.mails.single()))
    w.lost = FakeLost(Crypto.tokenHash(ByteArray(20)), w.time)
    assertEquals(status(enrolled = true, pending = PendingRecovery(null)), p.recovery.status())
    w.confirmLost(w.time + 1000)
    assertEquals(status(enrolled = true, pending = PendingRecovery(w.time + 1000)), p.recovery.status())
  }
}
