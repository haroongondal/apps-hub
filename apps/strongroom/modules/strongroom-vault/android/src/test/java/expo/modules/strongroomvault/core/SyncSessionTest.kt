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

class SyncSessionTest {
  private val fast = KdfParams(1024, 1, 1)
  private val password = "correct horse battery staple".toCharArray()
  private val newPassword = "a brand new master password".toCharArray()
  private val recoveryKey = ByteArray(20) { (it + 1).toByte() }
  private val w = FakeWorker()

  @Before fun lowerKdfFloor() {
    KdfParams.testFloor = fast
  }

  @After fun clearKdfFloor() {
    KdfParams.testFloor = null
  }

  private fun refused(message: String, block: () -> Unit) =
    assertEquals(message, assertThrows(IllegalStateException::class.java) { block() }.message)

  // A phone with a vault, sync turned on and its first sync done; returns the account key it showed.
  private fun syncedPhone(vararg names: String): Pair<TestPhone, ByteArray> {
    val p = TestPhone(w.t)
    p.vault.setUp(password, recoveryKey, fast)
    for (n in names) p.vault.put(null, testLogin(n))
    return p to p.session.enable(SETUP_TOKEN, password, recoveryKey)!!
  }

  @Test fun enableCommitsLocallyFirstAndARetryOnlyRepeatsThePut() {
    val p = TestPhone(w.t)
    p.vault.setUp(password, recoveryKey, fast)
    assertEquals(SyncStatus("off", null, 0, 0, available = true), p.session.status())
    val bank = p.vault.put(null, testLogin("Bank"))
    val before = p.header()
    w.offline = true
    assertThrows(SyncOfflineError::class.java) { p.session.enable(SETUP_TOKEN, password, recoveryKey) }
    assertEquals(SyncMode.PENDING_SETUP, p.settings.state.mode)
    assertEquals("pendingSetup", p.session.status().state)
    val stored = p.secrets.get(SyncSecret.ACCOUNT_KEY)!!
    assertTrue(p.header().accountKey)
    assertEquals(before.kdf, p.header().kdf)
    assertFalse(before.salt.contentEquals(p.header().salt))
    assertNull(w.header)
    p.vault.lock()
    assertTrue(p.vault.unlock(password)) // the Keystore copy opens the flagged header

    w.offline = false
    val shown = p.session.enable(SETUP_TOKEN, password, recoveryKey)!!
    assertArrayEquals(stored, shown)
    assertEquals(listOf("create", "pull 0 login", "push login ${bank.takeLast(2)}@0"), w.calls)
    assertEquals(p.store.header(), w.header)
    assertEquals(Crypto.tokenHash(VaultFormat.recoveryLoginToken(recoveryKey)), w.recoveryHash)
    assertEquals(SyncMeta(0, 1), p.store.meta)
    assertEquals(SyncMode.ON, p.settings.state.mode)
    assertEquals("idle", p.session.status().state)
    refused("sync already on") { p.session.enable(SETUP_TOKEN, password, recoveryKey) }
  }

  @Test fun aRetryAfterALostReplyFindsTheAccountItCreated() {
    var dropReply = true
    val flaky = object : SyncTransport by w.t {
      override fun putAccount(setupToken: String, body: AccountCreate): Long {
        val rev = w.t.putAccount(setupToken, body)
        if (dropReply) {
          dropReply = false
          throw SyncOfflineError()
        }
        return rev
      }
    }
    val p = TestPhone(flaky)
    p.vault.setUp(password, recoveryKey, fast)
    assertThrows(SyncOfflineError::class.java) { p.session.enable(SETUP_TOKEN, password, recoveryKey) }
    assertTrue(p.session.enable(SETUP_TOKEN, password, recoveryKey) != null)
    assertEquals(listOf("create", "create", "pull 0 login", "pull 0 login"), w.calls) // 403, then its own token reads back its own header
    assertEquals(SyncMode.ON, p.settings.state.mode)
    assertEquals(1, p.store.meta.headerRev)
  }

  // Final review 1: a refusal that created nothing on the server puts the vault back, so it never needs a key the owner hasn't seen.
  @Test fun aRefusedSetupPutsTheVaultBackAndARetryShowsTheSameKey() {
    var refuseWith: Exception? = SyncHttpError(400)
    val strict = object : SyncTransport by w.t {
      override fun putAccount(setupToken: String, body: AccountCreate): Long {
        refuseWith?.let {
          refuseWith = null
          throw it
        }
        return w.t.putAccount(setupToken, body)
      }
    }
    val p = TestPhone(strict)
    p.vault.setUp(password, recoveryKey, fast)
    val before = p.store.header()
    assertEquals(400, assertThrows(SyncHttpError::class.java) { p.session.enable(SETUP_TOKEN, password, recoveryKey) }.status)
    assertEquals(before, p.store.header())
    assertEquals(SyncMode.OFF, p.settings.state.mode)
    val kept = p.secrets.get(SyncSecret.ACCOUNT_KEY)!!

    refused("wrong setup token") { p.session.enable("not the setup code", password, recoveryKey) }
    assertEquals(before, p.store.header())
    assertEquals(SyncMode.OFF, p.settings.state.mode)
    p.vault.lock()
    p.secrets.values.remove(SyncSecret.ACCOUNT_KEY)
    assertTrue(p.vault.unlock(password)) // the master password alone opens it
    p.secrets.put(SyncSecret.ACCOUNT_KEY, kept)

    val otherKey = RecoveryKey.generate()
    val other = TestPhone(w.t).also { it.vault.setUp(password, otherKey, fast) }
    val otherBefore = other.store.header()
    assertArrayEquals(kept, p.session.enable(SETUP_TOKEN, password, recoveryKey)) // the key from the first try
    refused("account exists") { other.session.enable(SETUP_TOKEN, password, otherKey) } // 403, and not this phone's own account
    assertEquals(otherBefore, other.store.header())
    assertEquals(SyncMode.OFF, other.settings.state.mode)
  }

  @Test fun onlyAnAmbiguousSetupFailureLeavesSetupPending() {
    var fail = true
    val busy = object : SyncTransport by w.t {
      override fun putAccount(setupToken: String, body: AccountCreate): Long {
        if (fail) {
          fail = false
          throw SyncHttpError(503)
        }
        return w.t.putAccount(setupToken, body)
      }
    }
    val p = TestPhone(busy)
    p.vault.setUp(password, recoveryKey, fast)
    assertEquals(503, assertThrows(SyncHttpError::class.java) { p.session.enable(SETUP_TOKEN, password, recoveryKey) }.status)
    assertEquals("pendingSetup", p.session.status().state)
    assertTrue(p.header().accountKey)
    refused("wrong setup token") { p.session.enable("not the setup code", password, recoveryKey) } // a retry's refusal keeps what the first try left
    assertEquals("pendingSetup", p.session.status().state)
    assertTrue(p.header().accountKey)
    assertTrue(p.session.enable(SETUP_TOKEN, password, recoveryKey) != null)
    assertEquals(SyncMode.ON, p.settings.state.mode)
  }

  @Test fun enableChangesNothingForAWrongPasswordOrAnotherVaultsRecoveryKey() {
    val p = TestPhone(w.t)
    p.vault.setUp(password, recoveryKey, fast)
    val json = p.store.header()
    assertNull(p.session.enable(SETUP_TOKEN, "not the master password".toCharArray(), recoveryKey))
    refused("wrong recovery key") { p.session.enable(SETUP_TOKEN, password, RecoveryKey.generate()) }
    assertEquals(json, p.store.header())
    assertNull(p.secrets.get(SyncSecret.ACCOUNT_KEY))
    assertEquals(SyncMode.OFF, p.settings.state.mode)
    assertTrue(w.calls.isEmpty())
  }

  @Test fun showAccountKeyNeedsTheMasterPassword() {
    val (p, ak) = syncedPhone()
    assertArrayEquals(ak, p.session.showAccountKey(password))
    assertNull(p.session.showAccountKey(newPassword))
  }

  @Test fun signInOnAFreshPhoneCommitsEverythingInOneWrite() {
    val (a, ak) = syncedPhone("Bank", "Mail")
    val b = TestPhone(w.t)
    b.session.signIn(password, ak)
    assertEquals(1, b.store.writes)
    assertEquals(listOf("Bank", "Mail"), b.names())
    assertEquals(a.store.header(), b.store.header())
    assertEquals(SyncMeta(w.latestRev, w.headerRev), b.store.meta)
    assertEquals(SyncMode.ON, b.settings.state.mode)
    assertArrayEquals(ak, b.secrets.get(SyncSecret.ACCOUNT_KEY))
    b.vault.lock()
    assertTrue(b.vault.unlock(password))
  }

  @Test fun aPhoneSignedInToAnEmptyVaultCanStillUnlockByKey() {
    val (_, ak) = syncedPhone()
    val b = TestPhone(w.t)
    b.session.signIn(password, ak)
    assertEquals(listOf(KEY_CHECK_ID), b.store.records.keys.toList())
    val key = b.vault.keyCopy()!!
    b.vault.lock()
    assertTrue(b.vault.unlockWithKey(key))
  }

  @Test fun aPasswordChangedElsewhereAsksForSignInOnceAndSignInKeepsLocalEdits() {
    val (a, ak) = syncedPhone("Bank")
    val b = TestPhone(w.t).also { it.session.signIn(password, ak) }
    val bank = b.vault.rows().single().id
    b.time++
    b.vault.put(bank, testLogin("Bank, edited here"))
    assertTrue(a.session.changePassword(password, newPassword))
    a.session.sync()

    w.calls.clear()
    assertThrows(SyncAuthError::class.java) { b.session.sync() }
    assertEquals("needsSignIn", b.session.status().state)
    assertThrows(SyncAuthError::class.java) { b.session.sync() }
    assertEquals(0, b.session.download())
    assertEquals(1, w.calls.size) // one refused pull, never a retry loop

    b.session.signIn(newPassword, ak)
    assertEquals(w.header, b.store.header())
    assertTrue(b.store.state(bank).third) // the edit is still waiting to go up
    b.session.sync()
    a.session.sync()
    assertEquals("Bank, edited here", (a.vault.get(bank) as Entry.Login).name)
    b.vault.lock()
    assertTrue(b.vault.unlock(newPassword))
  }

  @Test fun signInRefusesAPhoneThatHoldsAnotherVault() {
    val (_, ak) = syncedPhone("Bank")
    val b = TestPhone(w.t)
    b.vault.setUp(password, RecoveryKey.generate(), fast)
    b.vault.put(null, testLogin("Mine"))
    val json = b.store.header()
    refused("different vault") { b.session.signIn(password, ak) }
    assertEquals(json, b.store.header())
    assertEquals(listOf("Mine"), b.names())
    assertNull(b.secrets.get(SyncSecret.ACCOUNT_KEY))
    assertEquals(SyncMode.OFF, b.settings.state.mode)
  }

  @Test fun aPasswordChangeIsSentAsAnAccountUpdateSignedWithTheOldToken() {
    val (a, ak) = syncedPhone("Bank")
    val oldLogin = a.secrets.get(SyncSecret.LOGIN_TOKEN)!!
    assertTrue(a.session.changePassword(password, newPassword))
    assertArrayEquals(oldLogin, a.secrets.get(SyncSecret.LOGIN_TOKEN)) // the server's token until the update lands
    w.offline = true
    assertThrows(SyncOfflineError::class.java) { a.session.sync() }
    assertTrue(a.settings.state.accountPending)
    assertEquals("error", a.session.status().state)

    w.offline = false
    w.calls.clear()
    a.session.sync()
    assertEquals(listOf("update login ifRev=1", "pull 0 login"), w.calls)
    assertEquals(a.store.header(), w.header)
    assertEquals(2, a.store.meta.headerRev)
    assertFalse(a.settings.state.accountPending)
    assertNull(a.secrets.get(SyncSecret.NEXT_LOGIN))
    assertNull(a.secrets.get(SyncSecret.NEXT_READ))
    assertFalse(oldLogin.contentEquals(a.secrets.get(SyncSecret.LOGIN_TOKEN)))
    assertEquals("idle", a.session.status().state)
    TestPhone(w.t).session.signIn(newPassword, ak)
    assertThrows(SyncAuthError::class.java) { TestPhone(w.t).session.signIn(password, ak) }
  }

  @Test fun aNewRecoveryKeySendsItsHashAndRecoverySignsInWithIt() {
    val (a, ak) = syncedPhone("Bank")
    val rk2 = a.session.newRecoveryKey(password)!!
    a.session.sync()
    assertTrue("update login ifRev=1 recovery" in w.calls)
    assertEquals(Crypto.tokenHash(VaultFormat.recoveryLoginToken(rk2)), w.recoveryHash)

    a.vault.lock()
    assertThrows(SyncAuthError::class.java) { a.session.recover(recoveryKey, newPassword) }
    a.session.recover(rk2, newPassword)
    assertTrue(w.calls.last().startsWith("update recovery ifRev=2"))
    assertTrue(a.vault.isUnlocked)
    assertEquals(w.header, a.store.header())
    assertEquals(listOf("Bank"), a.names())
    a.vault.lock()
    assertTrue(a.vault.unlock(newPassword))
    TestPhone(w.t).session.signIn(newPassword, ak)
  }

  @Test fun aHeaderChangedElsewhereIsAdoptedOnlyWithThePassword() {
    val (a, ak) = syncedPhone("Bank")
    val b = TestPhone(w.t).also { it.session.signIn(password, ak) }
    val rk2 = b.session.newRecoveryKey(password)!!
    b.session.sync()

    val old = a.store.header()
    assertTrue(a.session.sync().headerChanged)
    assertEquals(old, a.store.header())
    assertTrue(a.session.sync(password).headerChanged)
    assertEquals(w.header, a.store.header())
    assertEquals(w.headerRev, a.store.meta.headerRev)
    assertFalse(a.session.sync().headerChanged)
    assertTrue(VaultFormat.unlockWithRecovery(a.header(), rk2) != null)
  }

  @Test fun aLockedDownloadMergesAtTheNextUnlockEvenOffline() {
    val (a, ak) = syncedPhone("Bank")
    val b = TestPhone(w.t).also { it.session.signIn(password, ak) }
    val mail = a.vault.put(null, testLogin("Mail"))
    a.session.sync()
    b.vault.lock()
    assertEquals(1, b.session.download())
    assertEquals(listOf(mail), b.store.staged().map { it.id })
    assertTrue(mail !in b.store.records)

    assertTrue(b.vault.unlock(password))
    w.offline = true
    assertThrows(SyncOfflineError::class.java) { b.session.sync() }
    assertEquals(listOf("Bank", "Mail"), b.names())
    assertTrue(b.store.staged().isEmpty())
    assertEquals(w.latestRev, b.store.meta.lastRev)
  }

  @Test fun aDownloadRefusesAnOlderHistory() {
    val (_, ak) = syncedPhone("Bank")
    val b = TestPhone(w.t).also { it.session.signIn(password, ak) }
    b.vault.lock()
    w.headerRev = 0
    assertThrows(SyncRollbackError::class.java) { b.session.download() }
    w.headerRev = 1
    w.latestRev = 0
    assertThrows(SyncRollbackError::class.java) { b.session.download() }
    assertEquals("error", b.session.status().state)
    assertTrue(b.store.staged().isEmpty())
    assertNotEquals(0L, b.store.meta.lastRev)
  }

  // Fix round 1: a locked download before the account update must neither run nor lose that update.
  private fun pendingChangeSurvivesALockedDownload(change: (TestPhone) -> Unit) {
    val (a, ak) = syncedPhone("Bank")
    change(a)
    w.offline = true
    assertThrows(SyncOfflineError::class.java) { a.session.sync() }
    w.offline = false
    a.vault.lock()
    w.calls.clear()
    assertEquals(0, a.session.download())
    assertTrue(w.calls.isEmpty())
    assertEquals(SyncMode.ON, a.settings.state.mode)
    assertTrue(a.settings.state.accountPending)
    assertTrue(a.secrets.get(SyncSecret.NEXT_LOGIN) != null)
    assertTrue(a.vault.unlock(newPassword))
    a.session.sync()
    assertEquals(a.store.header(), w.header)
    assertFalse(a.settings.state.accountPending)
    TestPhone(w.t).session.signIn(newPassword, ak)
  }

  @Test fun aLockedDownloadKeepsAPasswordChangeThatHasNotGoneUp() = pendingChangeSurvivesALockedDownload {
    assertTrue(it.session.changePassword(password, newPassword))
  }

  @Test fun aLockedDownloadKeepsALocalRecoveryThatHasNotGoneUp() = pendingChangeSurvivesALockedDownload {
    it.vault.lock()
    assertTrue(it.session.recoverLocally(recoveryKey, newPassword))
  }

  @Test fun aRefusedTokenAsksToSignInButKeepsThePendingUpdate() {
    val (a, _) = syncedPhone("Bank")
    assertTrue(a.session.changePassword(password, newPassword))
    w.loginHash = "changed on another device"
    assertThrows(SyncAuthError::class.java) { a.session.sync() }
    assertEquals("needsSignIn", a.session.status().state)
    assertTrue(a.settings.state.accountPending)
    assertTrue(a.secrets.get(SyncSecret.NEXT_LOGIN) != null)
  }

  // Final review 4: the new tokens wait under their own names and the pending mark names the new header, both before the header is written.
  @Test fun aBookkeepingStepThatFailsBeforeTheHeaderWriteChangesNothing() {
    val (a, ak) = syncedPhone("Bank")
    val before = a.store.header()
    val login = a.secrets.get(SyncSecret.LOGIN_TOKEN)
    for (step in listOf(SyncSecret.NEXT_LOGIN, SyncSecret.NEXT_READ)) {
      a.secrets.failOn = step
      refused("disk full") { a.session.changePassword(password, newPassword) }
      a.secrets.failOn = null
    }
    a.settings.failSave = true
    refused("disk full") { a.session.changePassword(password, newPassword) }
    refused("disk full") { a.session.newRecoveryKey(password) }
    a.settings.failSave = false
    assertEquals(before, a.store.header())
    assertFalse(a.settings.state.accountPending)
    assertArrayEquals(login, a.secrets.get(SyncSecret.LOGIN_TOKEN))

    w.calls.clear()
    a.session.sync()
    assertFalse(w.calls.any { it.startsWith("update") })
    a.vault.lock()
    assertTrue(a.vault.unlock(password))
    TestPhone(w.t).session.signIn(password, ak)
  }

  @Test fun aHeaderWriteThatFailsDropsItsPendingUpdateAtTheNextSync() {
    val (a, ak) = syncedPhone("Bank")
    val before = a.store.header()
    a.store.headerWriteFails = true
    refused("disk full") { a.session.changePassword(password, newPassword) }
    a.store.headerWriteFails = false
    assertEquals(before, a.store.header())
    assertTrue(a.settings.state.accountPending)

    w.calls.clear()
    a.session.sync()
    assertFalse(w.calls.any { it.startsWith("update") })
    assertEquals(before, w.header)
    assertFalse(a.settings.state.accountPending)
    assertNull(a.secrets.get(SyncSecret.NEXT_LOGIN))
    assertNull(a.secrets.get(SyncSecret.NEXT_READ))
    a.session.sync()
    a.vault.lock()
    assertTrue(a.vault.unlock(password))
    TestPhone(w.t).session.signIn(password, ak)
  }

  @Test fun aSwapCutShortFinishesAtTheNextSync() {
    val (a, ak) = syncedPhone("Bank")
    assertTrue(a.session.changePassword(password, newPassword))
    a.secrets.failOn = SyncSecret.READ_TOKEN
    refused("disk full") { a.session.sync() }
    a.secrets.failOn = null
    assertEquals(a.store.header(), w.header)
    assertTrue(a.settings.state.accountPending)

    a.session.sync()
    assertFalse(a.settings.state.accountPending)
    assertNull(a.secrets.get(SyncSecret.NEXT_LOGIN))
    assertEquals("idle", a.session.status().state)
    a.vault.lock()
    assertEquals(0, a.session.download())
    assertEquals("idle", a.session.status().state)
    TestPhone(w.t).session.signIn(newPassword, ak)
  }

  @Test fun anUpdateThatLandedBeforeTheSwapAsksToSignInWithTheNewPassword() {
    val (a, ak) = syncedPhone("Bank")
    assertTrue(a.session.changePassword(password, newPassword))
    a.secrets.failOn = SyncSecret.LOGIN_TOKEN
    refused("disk full") { a.session.sync() }
    a.secrets.failOn = null
    assertEquals(a.store.header(), w.header)

    assertThrows(SyncAuthError::class.java) { a.session.sync() }
    assertEquals("needsSignIn", a.session.status().state)
    a.session.signIn(newPassword, ak)
    assertFalse(a.settings.state.accountPending)
    assertNull(a.secrets.get(SyncSecret.NEXT_LOGIN))
    a.session.sync()
    assertEquals("idle", a.session.status().state)
  }

  @Test fun aNewRecoveryKeyAfterAPasswordChangeKeepsTheWaitingTokens() {
    val (a, ak) = syncedPhone("Bank")
    assertTrue(a.session.changePassword(password, newPassword))
    val rk2 = a.session.newRecoveryKey(newPassword)!!
    a.session.sync()
    assertEquals(a.store.header(), w.header)
    assertEquals(Crypto.tokenHash(VaultFormat.recoveryLoginToken(rk2)), w.recoveryHash)
    TestPhone(w.t).session.signIn(newPassword, ak)
    a.session.sync()
  }

  // Final review 1: with the Keystore's account key gone, a local reset takes the written-down one.
  @Test fun aLocalResetTakesATypedAccountKeyWhenThePhoneHasNone() {
    val (a, ak) = syncedPhone("Bank")
    a.vault.lock()
    a.secrets.values.remove(SyncSecret.ACCOUNT_KEY)
    assertThrows(AccountKeyRequired::class.java) { a.session.recoverLocally(recoveryKey, newPassword) }
    assertFalse(a.session.recoverLocally(RecoveryKey.generate(), newPassword, ak))
    assertNull(a.secrets.get(SyncSecret.ACCOUNT_KEY))
    assertTrue(a.session.recoverLocally(recoveryKey, newPassword, ak))
    assertArrayEquals(ak, a.secrets.get(SyncSecret.ACCOUNT_KEY))
    a.vault.lock()
    assertTrue(a.vault.unlock(newPassword))
    a.session.sync()
    TestPhone(w.t).session.signIn(newPassword, ak)
  }

  @Test fun aLocalResetIgnoresATypedAccountKeyWhenThePhoneHoldsOne() {
    val (a, ak) = syncedPhone("Bank")
    a.vault.lock()
    assertTrue(a.session.recoverLocally(recoveryKey, newPassword, AccountKey.generate()))
    assertArrayEquals(ak, a.secrets.get(SyncSecret.ACCOUNT_KEY))
    a.session.sync()
    TestPhone(w.t).session.signIn(newPassword, ak)
  }

  @Test fun aLocalResetWithSyncOffNeedsNoServer() {
    val p = TestPhone(null)
    p.vault.setUp(password, recoveryKey, fast)
    p.vault.lock()
    assertTrue(p.session.recoverLocally(recoveryKey, newPassword))
    p.vault.lock()
    assertTrue(p.vault.unlock(newPassword))
    assertTrue(p.session.changePassword(newPassword, password))
    assertTrue(p.session.newRecoveryKey(password) != null)
    assertFalse(p.settings.state.accountPending)
  }

  @Test fun signInRefusesAServerHeaderThatDroppedTheAccountKeyFlag() {
    val (a, ak) = syncedPhone("Bank")
    w.header = a.header().copy(accountKey = false).toJson() // still wrapped with the account key, so it would open
    val b = TestPhone(w.t)
    assertThrows(SyncAuthError::class.java) { b.session.signIn(password, ak) }
    assertNull(b.store.header())
    assertNull(b.secrets.get(SyncSecret.ACCOUNT_KEY))
    assertEquals(SyncMode.OFF, b.settings.state.mode)
  }

  // Final review 6: as the extension's recovery sign-in, never re-flag a header the server sent without the flag.
  @Test fun recoveryRefusesAServerHeaderThatDroppedTheAccountKeyFlag() {
    val (a, ak) = syncedPhone("Bank")
    val dropped = a.header().copy(accountKey = false).toJson()
    w.header = dropped
    val c = TestPhone(w.t)
    assertThrows(SyncAuthError::class.java) { c.session.recover(recoveryKey, newPassword, ak) }
    assertEquals(dropped, w.header)
    assertFalse(w.calls.any { it.startsWith("update") })
    assertNull(c.store.header())
    assertNull(c.secrets.get(SyncSecret.ACCOUNT_KEY))
    assertEquals(SyncMode.OFF, c.settings.state.mode)
  }

  @Test fun anOfflineDownloadIsNotAnError() {
    val (_, ak) = syncedPhone("Bank")
    val b = TestPhone(w.t).also { it.session.signIn(password, ak) }
    b.vault.lock()
    w.offline = true
    assertThrows(SyncOfflineError::class.java) { b.session.download() }
    assertEquals("idle", b.session.status().state)
  }

  @Test fun recoveryOnANewPhoneTakesATypedAccountKey() {
    val (_, ak) = syncedPhone("Bank")
    val c = TestPhone(w.t)
    assertThrows(AccountKeyRequired::class.java) { c.session.recover(recoveryKey, newPassword) }
    c.session.recover(recoveryKey, newPassword, ak)
    assertEquals(listOf("Bank"), c.names())
    assertArrayEquals(ak, c.secrets.get(SyncSecret.ACCOUNT_KEY))
    assertEquals(SyncMode.ON, c.settings.state.mode)
    c.vault.lock()
    assertTrue(c.vault.unlock(newPassword))
    TestPhone(w.t).session.signIn(newPassword, ak)
  }

  @Test fun signInReplacesASyncKeyTheSystemDropped() {
    val (a, ak) = syncedPhone("Bank")
    a.secrets.keyLost = true
    a.vault.lock()
    assertThrows(AccountKeyRequired::class.java) { a.vault.unlock(password) }
    a.session.signIn(password, ak)
    assertEquals(1, a.secrets.resets)
    assertArrayEquals(ak, a.secrets.get(SyncSecret.ACCOUNT_KEY))
    a.vault.lock()
    assertTrue(a.vault.unlock(password))
  }

  @Test fun withoutAServerEverySyncEntryPointIsOff() {
    val p = TestPhone(null)
    p.vault.setUp(password, recoveryKey, fast)
    assertEquals(SyncStatus("off", null, 0, 0, available = false), p.session.status())
    refused("sync unavailable") { p.session.enable(SETUP_TOKEN, password, recoveryKey) }
    refused("sync unavailable") { p.session.signIn(password, ByteArray(20)) }
    refused("sync unavailable") { p.session.recover(recoveryKey, newPassword) }
    refused("sync unavailable") { p.session.sync() }
    assertEquals(0, p.session.download())
  }
}
