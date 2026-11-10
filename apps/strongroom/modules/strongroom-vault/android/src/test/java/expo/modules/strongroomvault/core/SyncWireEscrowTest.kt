package expo.modules.strongroomvault.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncWireEscrowTest {
  private fun refused(status: Int, call: () -> Unit) {
    val e = assertThrows(SyncHttpError::class.java) { call() }
    assertFalse(e is SyncAuthError)
    assertEquals(status, e.status)
  }

  private val update = AccountUpdate("h", "l", "d", 4, "r")

  @Test fun accountUpdateWithEscrowSerializesTheEscrowObject() {
    val sent = Json.parseToJsonElement(SyncWire.toJson(update.copy(escrow = EscrowBody("me@example.com", "AAAA", "CODE-1")))).jsonObject
    assertEquals(buildJsonObject { put("email", "me@example.com"); put("blob", "AAAA"); put("code", "CODE-1") }, sent.getValue("escrow"))
    assertEquals(setOf("header", "loginHash", "recoveryHash", "readHash", "ifRev", "escrow"), sent.keys)
  }

  @Test fun accountUpdateWithoutEscrowOmitsIt() {
    assertEquals(setOf("header", "loginHash", "recoveryHash", "readHash", "ifRev"), Json.parseToJsonElement(SyncWire.toJson(update)).jsonObject.keys)
    assertNull(update.escrow)
  }

  @Test fun lostStatusParsesPendingAndNull() {
    assertEquals(LostStatus(true, true, 1_800_000_000_000L), SyncWire.lostStatus(200, """{"escrow":true,"pending":{"releaseAt":1800000000000}}"""))
    assertEquals(LostStatus(true, true, null), SyncWire.lostStatus(200, """{"escrow":true,"pending":{"releaseAt":null}}"""))
    assertEquals(LostStatus(false, false, null), SyncWire.lostStatus(200, """{"escrow":false,"pending":null}"""))
  }

  @Test fun lostReleaseParsesReadyAndWaiting() {
    assertEquals(LostRelease.Ready("AAAA"), SyncWire.lostRelease(200, """{"state":"ready","blob":"AAAA"}"""))
    assertEquals(LostRelease.Waiting(42), SyncWire.lostRelease(200, """{"state":"waiting","releaseAt":42}"""))
    assertEquals(LostRelease.Waiting(null), SyncWire.lostRelease(200, """{"state":"waiting","releaseAt":null}"""))
  }

  @Test fun okRepliesAreChecked() {
    SyncWire.ok(200, """{"ok":true}""")
    refused(200) { SyncWire.ok(200, """{"ok":false}""") }
    refused(200) { SyncWire.ok(200, """{}""") }
    refused(200) { SyncWire.ok(200, """{"ok":"true"}""") }
  }

  @Test fun everyNewCallMapsAuthAndStatusFailures() {
    val calls = listOf<(Int, String) -> Unit>(
      { s, b -> SyncWire.lostStatus(s, b) },
      { s, b -> SyncWire.lostRelease(s, b) },
      { s, b -> SyncWire.ok(s, b) },
    )
    for (call in calls) {
      assertThrows(SyncAuthError::class.java) { call(401, """{"error":"no"}""") }
      assertThrows(SyncAuthError::class.java) { call(401, "not json") }
      refused(500) { call(500, """{"error":"boom"}""") }
      refused(403) { call(403, "not json") }
      refused(502) { call(502, "") }
    }
  }

  @Test fun mangledLostRepliesAreUnreadableNotCrashes() {
    val statusBodies = listOf(
      "null", "[]", "{}", "not json", "", """{"escrow":true}""", """{"pending":null}""",
      """{"escrow":"yes","pending":null}""", """{"escrow":true,"pending":"soon"}""", """{"escrow":true,"pending":{}}""",
      """{"escrow":true,"pending":{"releaseAt":"5"}}""", """{"escrow":true,"pending":{"releaseAt":9007199254740992}}""",
      """{"escrow":true,"pending":{"releaseAt":-1}}""", """{"escrow":true,"pending":{"releaseAt":1.5}}""",
    )
    for (b in statusBodies) refused(200) { SyncWire.lostStatus(200, b) }

    val releaseBodies = listOf(
      "null", "[]", "{}", "not json", "", """{"blob":"AAAA"}""", """{"state":"done","blob":"AAAA"}""", """{"state":5}""",
      """{"state":"ready"}""", """{"state":"ready","blob":7}""", """{"state":"ready","blob":"not*base64"}""", """{"state":"ready","blob":"AAA"}""",
      """{"state":"ready","blob":"${"A".repeat(SyncWire.MAX_CIPHERTEXT_CHARS + 4)}"}""",
      """{"state":"waiting"}""", """{"state":"waiting","releaseAt":"5"}""", """{"state":"waiting","releaseAt":-3}""",
      "[" .repeat(100_000) + "]".repeat(100_000),
    )
    for (b in releaseBodies) refused(200) { SyncWire.lostRelease(200, b) }

    for (b in listOf("null", "[]", "not json", "", """{"okay":true}""")) refused(200) { SyncWire.ok(200, b) }
    assertTrue(SyncWire.lostRelease(200, """{"state":"ready","blob":"${"A".repeat(SyncWire.MAX_CIPHERTEXT_CHARS)}"}""") is LostRelease.Ready)
  }

  // The fake must keep the Worker's rules, or later tests prove nothing.
  private val login = ByteArray(32) { 1 }
  private val recovery = ByteArray(32) { 2 }
  private val read = ByteArray(32) { 3 }
  private val escrow = EscrowBody("me@example.com", "AAAA", "CODE-1")

  private fun account(): FakeWorker = FakeWorker().also {
    it.t.putAccount(SETUP_TOKEN, AccountCreate("h1", Crypto.tokenHash(login), Crypto.tokenHash(recovery), Crypto.tokenHash(read)))
  }

  private fun enrol(w: FakeWorker, recoveryHash: String? = "r2", ifRev: Long = w.headerRev, e: EscrowBody? = escrow) =
    w.t.putAccount(login, AccountUpdate("h2", Crypto.tokenHash(login), Crypto.tokenHash(read), ifRev, recoveryHash, e))

  private val claim = ByteArray(20) { (it + 9).toByte() }
  private val claimText get() = SyncWire.toBase64(claim)

  @Test fun fakeMailsThenStoresTheEscrow() {
    val w = account()
    assertEquals(2L, enrol(w))
    assertEquals(FakeEscrow("me@example.com", "AAAA", "CODE-1"), w.escrow)
    assertEquals(listOf("CODE-1"), w.mails)
    assertEquals("r2", w.recoveryHash)
  }

  @Test fun fakeRefusesEscrowWithoutARecoveryHash() {
    val w = account()
    assertEquals(400, assertThrows(SyncHttpError::class.java) { enrol(w, recoveryHash = null) }.status)
    assertNull(w.escrow)
    assertTrue(w.mails.isEmpty())
    assertEquals(1L, w.headerRev)
  }

  @Test fun fakeRefusesMalformedEscrow() {
    for (bad in listOf(escrow.copy(email = "no-at-sign"), escrow.copy(email = "a@b.c".padEnd(321, 'x')), escrow.copy(blob = "not*base64"), escrow.copy(code = ""), escrow.copy(code = "x".repeat(65)))) {
      assertEquals(400, assertThrows(SyncHttpError::class.java) { enrol(account(), e = bad) }.status)
    }
  }

  @Test fun fakeAnswers502BeforeChangingAnyState() {
    val w = account()
    w.failMail = true
    assertEquals(502, assertThrows(SyncHttpError::class.java) { enrol(w) }.status)
    assertNull(w.escrow)
    assertEquals(1L, w.headerRev)
    assertEquals("h1", w.header)
    assertEquals(Crypto.tokenHash(recovery), w.recoveryHash)
    assertTrue(w.mails.isEmpty())
  }

  @Test fun fakeMailsEvenWhenTheRevisionIsStaleThenAnswers409WithoutWriting() {
    val w = account()
    assertEquals(409, assertThrows(SyncHttpError::class.java) { enrol(w, ifRev = 7) }.status)
    assertEquals(listOf("CODE-1"), w.mails) // the Worker mails first
    assertNull(w.escrow)
    assertEquals(1L, w.headerRev)
  }

  @Test fun fakeDropsTheEscrowWhenTheRecoveryHashChangesWithoutOne() {
    val w = account()
    enrol(w)
    w.confirmLost(0) // no request yet: must do nothing
    w.t.lostRequest(Crypto.tokenHash(claim))
    assertTrue(w.lost != null)
    enrol(w, recoveryHash = "r3", e = null)
    assertNull(w.escrow)
    assertNull(w.lost)
  }

  @Test fun fakeKeepsTheEscrowWhenTheRecoveryHashIsUnchangedOrAbsent() {
    val w = account()
    enrol(w)
    enrol(w, recoveryHash = "r2", e = null)
    assertEquals("CODE-1", w.escrow!!.code)
    enrol(w, recoveryHash = null, e = null)
    assertEquals("CODE-1", w.escrow!!.code)
  }

  @Test fun fakeLostAccessWalksRequestConfirmWaitAndRelease() {
    val w = account()
    enrol(w)
    w.t.lostRequest(Crypto.tokenHash(claim))
    assertEquals(LostStatus(true, true, null), w.t.lostStatus(read))
    assertEquals(LostRelease.Waiting(null), w.t.lostRelease(claimText))
    w.confirmLost(w.time + 86_400_000)
    assertEquals(LostStatus(true, true, w.time + 86_400_000), w.t.lostStatus(login))
    assertEquals(LostRelease.Waiting(w.time + 86_400_000), w.t.lostRelease(claimText))
    w.time += 86_400_000
    assertEquals(LostRelease.Ready("AAAA"), w.t.lostRelease(claimText))
    assertEquals(LostRelease.Waiting(null), w.t.lostRelease(SyncWire.toBase64(ByteArray(20) { 5 }))) // another claim learns nothing
    assertEquals(LostRelease.Waiting(null), w.t.lostRelease("short"))
  }

  @Test fun fakeLostRequestWithoutEscrowOrWhileOneIsAliveChangesNothing() {
    val w = account()
    w.t.lostRequest(Crypto.tokenHash(claim))
    assertNull(w.lost)
    enrol(w)
    w.t.lostRequest(Crypto.tokenHash(claim))
    w.time += 3_600_000
    w.t.lostRequest(Crypto.tokenHash(ByteArray(20) { 5 })) // unconfirmed, past the cooldown: replaced
    assertEquals(Crypto.tokenHash(ByteArray(20) { 5 }), w.lost!!.claimHash)
    w.confirmLost(w.time + 86_400_000)
    w.t.lostRequest(Crypto.tokenHash(claim)) // confirmed and not yet released: kept
    assertEquals(Crypto.tokenHash(ByteArray(20) { 5 }), w.lost!!.claimHash)
  }

  @Test fun fakeCancelStopsTheRequestAndAnyReleaseAndAllowsANewOne() {
    val w = account()
    enrol(w)
    w.t.lostRequest(Crypto.tokenHash(claim))
    w.confirmLost(w.time + 1)
    w.t.lostCancel(read)
    assertEquals(LostStatus(true, false, null), w.t.lostStatus(login))
    w.time += 10
    assertEquals(LostRelease.Waiting(null), w.t.lostRelease(claimText))
    w.t.lostRequest(Crypto.tokenHash(claim))
    assertEquals(LostStatus(true, true, null), w.t.lostStatus(login))
  }

  @Test fun fakeDeleteEscrowNeedsTheLoginTokenAndRemovesTheRequestToo() {
    val w = account()
    enrol(w)
    w.t.lostRequest(Crypto.tokenHash(claim))
    assertThrows(SyncAuthError::class.java) { w.t.deleteEscrow(recovery) }
    assertThrows(SyncAuthError::class.java) { w.t.deleteEscrow(read) }
    assertThrows(SyncAuthError::class.java) { w.t.deleteEscrow(ByteArray(32) { 9 }) }
    assertTrue(w.escrow != null)
    w.t.deleteEscrow(login)
    assertNull(w.escrow)
    assertNull(w.lost)
    assertEquals(LostStatus(false, false, null), w.t.lostStatus(read))
  }

  @Test fun fakeRefusesStatusAndCancelForAnUnknownToken() {
    val w = account()
    assertThrows(SyncAuthError::class.java) { w.t.lostStatus(ByteArray(32) { 9 }) }
    assertThrows(SyncAuthError::class.java) { w.t.lostCancel(ByteArray(32) { 9 }) }
  }

  @Test fun fakeOfflineAndCallLog() {
    val w = account()
    w.offline = true
    assertThrows(SyncOfflineError::class.java) { w.t.lostRequest("x") }
    assertThrows(SyncOfflineError::class.java) { w.t.lostRelease("x") }
    assertThrows(SyncOfflineError::class.java) { w.t.lostStatus(login) }
    assertThrows(SyncOfflineError::class.java) { w.t.lostCancel(login) }
    assertThrows(SyncOfflineError::class.java) { w.t.deleteEscrow(login) }
    w.offline = false
    w.t.lostStatus(read)
    w.t.deleteEscrow(login)
    assertEquals(listOf("create", "lostStatus read", "deleteEscrow login"), w.calls)
  }
}
