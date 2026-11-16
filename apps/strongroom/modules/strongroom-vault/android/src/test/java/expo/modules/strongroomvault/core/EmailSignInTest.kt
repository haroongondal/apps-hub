package expo.modules.strongroomvault.core

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

// A new phone signs in by email: the account key comes from the sign-in blob the enrolling device sealed under the emailed code.
class EmailSignInTest {
  private val fast = KdfParams(1024, 1, 1)
  private val password = "correct horse battery staple".toCharArray()
  private val recoveryKey = ByteArray(20) { (it + 1).toByte() }
  private val w = FakeWorker()
  private var lastUpdate: AccountUpdate? = null
  private val net = object : SyncTransport by w.t {
    override fun putAccount(token: ByteArray, body: AccountUpdate): Long {
      lastUpdate = body
      return w.t.putAccount(token, body)
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

  private class Enrolled(val ak: ByteArray, val code: String)

  private fun enrolled(): Enrolled {
    val p = TestPhone(net)
    p.vault.setUp(password, recoveryKey, fast)
    p.vault.put(null, testLogin("Bank"))
    val ak = p.session.enable(SETUP_TOKEN, password, recoveryKey)!!
    p.recovery.enrol("me@example.com", password)!!
    return Enrolled(ak, w.mails.single())
  }

  private fun TestPhone.approved() {
    recovery.signinRequest()
    w.approveSignin()
    assertEquals(LostState.Ready, recovery.signinCheck())
  }

  @Test fun enrolSendsTheSignInBlobInTheSamePutAndItOpensToTheAccountKeyUnderTheCode() {
    val e = enrolled()
    val sent = lastUpdate!!
    assertNotNull(sent.escrow)
    assertEquals(w.signinBlob, sent.signin!!.blob)
    assertArrayEquals(e.ak, Escrow.openSignin(RecoveryKey.parse(e.code)!!, SyncWire.fromBase64(sent.signin!!.blob)!!))
    assertNull(Escrow.open(RecoveryKey.parse(e.code)!!, SyncWire.fromBase64(sent.signin!!.blob)!!)) // not an escrow
  }

  @Test fun requestCheckAndOpenSignTheNewPhoneIn() {
    val e = enrolled()
    val q = TestPhone(net)
    assertEquals(LostState.None, q.recovery.signinCheck())
    q.recovery.signinRequest()
    val claim = SyncWire.fromBase64(q.recoverySettings.state.signinClaim!!)!!
    assertEquals(20, claim.size)
    assertEquals(Crypto.tokenHash(claim), w.signin!!.claimHash)
    assertTrue(w.calls.contains("signinRequest Strongroom for Android"))
    assertEquals(LostState.Waiting(null), q.recovery.signinCheck())
    w.approveSignin(w.time + 5)
    assertEquals(LostState.Waiting(w.time + 5), q.recovery.signinCheck())
    w.time += 5
    assertEquals(LostState.Ready, q.recovery.signinCheck())
    assertEquals(w.signinBlob, q.recoverySettings.state.signinBlob)

    assertTrue(q.recovery.signinOpen(" " + e.code.replace("-", "").lowercase() + " ", password))
    assertEquals(SyncMode.ON, q.settings.state.mode)
    assertArrayEquals(e.ak, q.secrets.get(SyncSecret.ACCOUNT_KEY))
    assertEquals(listOf("Bank"), q.names())
    assertNull(q.recoverySettings.state.signinClaim)
    assertNull(q.recoverySettings.state.signinBlob)
  }

  @Test fun aFailedRequestKeepsAnEarlierClaim() {
    enrolled()
    val q = TestPhone(net)
    q.recovery.signinRequest()
    val first = q.recoverySettings.state
    w.offline = true
    assertThrows(SyncOfflineError::class.java) { q.recovery.signinRequest() }
    w.offline = false
    assertEquals(first, q.recoverySettings.state)
    q.recovery.signinRequest() // a new request makes a new claim and drops any blob
    assertTrue(first.signinClaim != q.recoverySettings.state.signinClaim)
  }

  @Test fun askingAgainNeverDropsAnApprovedClaim() {
    enrolled()
    val q = TestPhone(net)
    q.recovery.signinRequest()
    w.approveSignin(w.time + 5)
    val before = q.recoverySettings.state
    w.calls.clear()
    refused("sign-in approved") { q.recovery.signinRequest() } // approved, not yet released
    assertEquals(before, q.recoverySettings.state)
    assertEquals(listOf("signinRelease"), w.calls)
    w.time += 5
    refused("sign-in approved") { q.recovery.signinRequest() } // released
    assertEquals(before, q.recoverySettings.state)
    assertEquals(LostState.Ready, q.recovery.signinCheck())
  }

  @Test fun aReleasedBlobStaysReadyAfterTheWorkerForgetsTheRequest() {
    val e = enrolled()
    val q = TestPhone(net)
    q.approved()
    w.signin = null // the Worker drops an approved request an hour after release
    w.calls.clear()
    assertEquals(LostState.Ready, q.recovery.signinCheck())
    assertTrue(w.calls.isEmpty())
    assertNotNull(q.recoverySettings.state.signinBlob)
    assertTrue(q.recovery.signinOpen(e.code, password))
  }

  @Test fun aWrongOrMalformedCodeOpensNothingAndChangesNothing() {
    enrolled()
    val q = TestPhone(net)
    refused("sign-in not ready") { q.recovery.signinOpen("ABCD", password) }
    q.approved()
    val ready = q.recoverySettings.state
    w.calls.clear()
    assertEquals(false, q.recovery.signinOpen(RecoveryKey.format(RecoveryKey.generate()), password))
    assertEquals(false, q.recovery.signinOpen("not a code", password))
    assertEquals(ready, q.recoverySettings.state)
    assertTrue(w.calls.isEmpty())
    assertNull(q.secrets.get(SyncSecret.ACCOUNT_KEY))
  }

  @Test fun aWrongPasswordIsRefusedAndTheApprovalIsKept() {
    val e = enrolled()
    val q = TestPhone(net)
    q.approved()
    val ready = q.recoverySettings.state
    assertThrows(SyncAuthError::class.java) { q.recovery.signinOpen(e.code, "not the master password".toCharArray()) }
    assertEquals(ready, q.recoverySettings.state)
    assertTrue(q.recovery.signinOpen(e.code, password))
  }

  @Test fun aPhoneHoldingADifferentAccountKeyRefuses() {
    val e = enrolled()
    val q = TestPhone(net)
    q.secrets.put(SyncSecret.ACCOUNT_KEY, ByteArray(20) { 7 })
    q.approved()
    val ready = q.recoverySettings.state
    refused("different account") { q.recovery.signinOpen(e.code, password) }
    assertEquals(ready, q.recoverySettings.state)
    assertArrayEquals(ByteArray(20) { 7 }, q.secrets.get(SyncSecret.ACCOUNT_KEY))
  }

  @Test fun withoutAnEscrowTheWorkerHoldsNoSignInAndTheClaimStaysWaiting() {
    val q = TestPhone(net)
    q.recovery.signinRequest()
    assertNull(w.signin)
    assertEquals(LostState.Waiting(null), q.recovery.signinCheck())
    refused("sync unavailable") { TestPhone(null).recovery.signinRequest() }
  }
}
