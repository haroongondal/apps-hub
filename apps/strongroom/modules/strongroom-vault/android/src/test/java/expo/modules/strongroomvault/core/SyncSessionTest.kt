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
    assertTrue(a.vault.changePassword(password, newPassword))
    a.session.headerChanged(newPassword, null)
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
    assertTrue(a.vault.changePassword(password, newPassword))
    a.session.headerChanged(newPassword, null)
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
    assertNull(a.secrets.get(SyncSecret.PENDING_AUTH))
    assertEquals("idle", a.session.status().state)
    TestPhone(w.t).session.signIn(newPassword, ak)
    assertThrows(SyncAuthError::class.java) { TestPhone(w.t).session.signIn(password, ak) }
  }

  @Test fun aNewRecoveryKeySendsItsHashAndRecoverySignsInWithIt() {
    val (a, ak) = syncedPhone("Bank")
    val rk2 = a.vault.newRecoveryKey(password)!!
    a.session.headerChanged(null, rk2)
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
    val rk2 = b.vault.newRecoveryKey(password)!!
    b.session.headerChanged(null, rk2)
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
    assertTrue(b.store.staged().isEmpty())
    assertNotEquals(0L, b.store.meta.lastRev)
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
