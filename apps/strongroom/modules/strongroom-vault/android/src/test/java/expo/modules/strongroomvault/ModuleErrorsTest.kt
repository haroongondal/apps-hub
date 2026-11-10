package expo.modules.strongroomvault

import expo.modules.kotlin.exception.CodedException
import expo.modules.strongroomvault.core.AccountKey
import expo.modules.strongroomvault.core.AccountKeyRequired
import expo.modules.strongroomvault.core.Header
import expo.modules.strongroomvault.core.KdfOutOfRange
import expo.modules.strongroomvault.core.KdfParams
import expo.modules.strongroomvault.core.MemoryRecordStore
import expo.modules.strongroomvault.core.SyncAuthError
import expo.modules.strongroomvault.core.SyncHttpError
import expo.modules.strongroomvault.core.SyncOfflineError
import expo.modules.strongroomvault.core.SyncRollbackError
import expo.modules.strongroomvault.core.Vault
import expo.modules.strongroomvault.core.VaultFormat
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test

// Drives the real core so a reworded core message breaks this test instead of reaching the screens as a bare error.
class ModuleErrorsTest {
  private val fast = KdfParams(1024, 1, 1)
  private val password = "correct horse battery staple".toCharArray()
  private val recoveryKey = ByteArray(20) { (it + 1).toByte() }

  @Before fun lowerKdfFloor() {
    KdfParams.testFloor = fast
  }

  @After fun clearKdfFloor() {
    KdfParams.testFloor = null
  }

  private fun vault(store: MemoryRecordStore = MemoryRecordStore()) = Vault(store, { 0L }, { 0L })

  private fun guarded(block: () -> Unit): CodedException = assertThrows(CodedException::class.java) { guard(block) }

  private fun derived(block: () -> Unit): CodedException = assertThrows(CodedException::class.java) { derive(block) }

  @Test fun coreStateErrorsReachTheScreensAsCodes() {
    assertEquals("NOT_SET_UP", guarded { vault().unlock(password) }.code)
    val store = MemoryRecordStore()
    val v = vault(store).also { it.setUp(password, recoveryKey, fast) }
    assertEquals("ALREADY_SET_UP", guarded { v.setUp(password, recoveryKey, fast) }.code)
    v.lock()
    assertEquals("LOCKED", guarded { v.rows() }.code)
    assertEquals("LOCKED", guarded { v.putMany(emptyList()) }.code)
    store.headerJson = "{\"version\":1}"
    assertEquals("HEADER_UNREADABLE", guarded { vault(store).unlock(password) }.code)
  }

  @Test fun otherStateErrorsPassThroughUnchanged() {
    val e = IllegalStateException("something else")
    assertSame(e, coded(e))
  }

  @Test fun aHeaderOutsideTheKdfLimitsIsRefusedWithTheOwnersMessage() {
    val store = MemoryRecordStore()
    vault(store).setUp(password, recoveryKey, fast)
    store.headerJson = store.headerJson!!.replace(Regex("\"iterations\":\\d+"), "\"iterations\":17")
    val e = derived { vault(store).unlock(password) }
    assertEquals("KDF_OUT_OF_RANGE", e.code)
    assertEquals("Strongroom won't open this vault: its security settings are weaker than it allows. The vault file may have been changed.", e.message)
  }

  @Test fun runningOutOfMemoryDerivingIsTheSameRefusal() {
    assertEquals("KDF_OUT_OF_RANGE", derived { throw OutOfMemoryError() }.code)
    assertEquals("KDF_OUT_OF_RANGE", derived { throw KdfOutOfRange(fast) }.code)
    assertEquals("LOCKED", derived { throw IllegalStateException("locked") }.code)
  }

  @Test fun aVaultWithoutItsAccountKeyIsAClearRefusal() {
    val store = MemoryRecordStore()
    val v = vault(store).also { it.setUp(password, recoveryKey, fast) }
    val k = v.vaultKeyCopy(password)!!
    store.headerJson = VaultFormat.withAccountKey(Header.fromJson(store.headerJson!!)!!, k, password, AccountKey.generate()).toJson()
    val e = derived { vault(store).unlock(password) }
    assertEquals("ACCOUNT_KEY_REQUIRED", e.code)
    assertEquals(
      "This phone no longer holds your account key, so your master password can't open the vault on its own. Sign in to sync with your master password and account key.",
      e.message,
    )
  }

  @Test fun syncFailuresReachTheScreensAsCodes() {
    fun failed(e: Throwable) = assertThrows(CodedException::class.java) { syncCall { throw e } }
    assertEquals("SYNC_SIGN_IN", failed(SyncAuthError()).code)
    assertEquals(SyncAuthError().message, failed(SyncAuthError()).message)
    assertEquals("SYNC_SERVER", failed(SyncHttpError(500)).code)
    assertEquals("SYNC_OFFLINE", failed(SyncOfflineError()).code)
    assertEquals("SYNC_ROLLBACK", failed(SyncRollbackError()).code)
    assertEquals("ACCOUNT_KEY_REQUIRED", failed(AccountKeyRequired()).code)
    assertEquals("KDF_OUT_OF_RANGE", failed(KdfOutOfRange(fast)).code)
    val unavailable = failed(IllegalStateException("sync unavailable"))
    assertEquals("SYNC_UNAVAILABLE", unavailable.code)
    assertEquals("Sync isn't available in this build.", unavailable.message)
    val codes = listOf("sync off", "sync already on", "wrong recovery key", "different vault", "account exists").map { failed(IllegalStateException(it)).code }
    assertEquals(listOf("SYNC_OFF", "SYNC_ALREADY_ON", "WRONG_RECOVERY_KEY", "DIFFERENT_VAULT", "SYNC_ACCOUNT_EXISTS"), codes)
  }

  // Fix round 1: core faults that used to reach JS as raw text ("Check failed.") now carry a code and owner-ready copy.
  @Test fun internalSyncFaultsAreCodedToo() {
    fun failed(message: String) = assertThrows(CodedException::class.java) { syncCall { throw IllegalStateException(message) } }
    val check = failed("header check failed")
    assertEquals("HEADER_CHECK_FAILED", check.code)
    assertEquals("Strongroom couldn't check the vault's new settings, so it changed nothing. Close Strongroom, open it again and retry.", check.message)
    val lost = failed("sync key lost")
    assertEquals("SYNC_KEY_LOST", lost.code)
    assertEquals(
      "This phone's secure storage lost the key that protects your sync sign-in, so sync stopped. Sign in to sync again with your master password and account key.",
      lost.message,
    )
  }

  // Email recovery: the core throws plain exceptions with short messages; the module turns each into a code the screens explain.
  @Test fun emailRecoveryFaultsAreCodedWithOwnerReadyCopy() {
    fun failed(e: Throwable) = assertThrows(CodedException::class.java) { syncCall { throw e } }
    val email = failed(IllegalArgumentException("bad email"))
    assertEquals("BAD_EMAIL", email.code)
    assertEquals("That email address isn't valid. Check it and try again.", email.message)
    val first = failed(IllegalStateException("sync first"))
    assertEquals("SYNC_FIRST", first.code)
    assertEquals("This phone has changes it hasn't synced yet. Choose Sync now, then try again.", first.message)
    assertEquals("SYNC_OFF", failed(IllegalStateException("sync off")).code)
    val mail = failed(IllegalStateException("mail failed"))
    assertEquals("MAIL_FAILED", mail.code)
    assertEquals("We couldn't send the email, so nothing changed and your old recovery key still works. Try again later.", mail.message)
    val moved = failed(IllegalStateException("vault moved"))
    assertEquals("VAULT_MOVED", moved.code)
    assertEquals("Your vault changed on another device, so nothing changed and your old recovery key still works. Choose Sync now, then try again.", moved.message)
    val alive = failed(IllegalStateException("request alive"))
    assertEquals("LOST_STILL_ALIVE", alive.code)
    assertEquals("A recovery request is already counting down on this account. Wait for it to finish, or cancel it from a device that is signed in.", alive.message)
    val early = failed(IllegalStateException("not ready"))
    assertEquals("LOST_NOT_READY", early.code)
    assertEquals("The 24-hour wait isn't over yet. Try again once it ends.", early.message)
    val other = failed(IllegalStateException("different account"))
    assertEquals("LOST_DIFFERENT_ACCOUNT", other.code)
    assertEquals(
      "This phone is already set up with another Strongroom account, so it can't open this vault. Use a phone or a fresh install that has no Strongroom account.",
      other.message,
    )
  }

  @Test fun aConfirmWithNothingToConfirmIsCodedNotRaw() {
    val e = assertThrows(CodedException::class.java) { syncCall { throw IllegalStateException("not waiting") } }
    assertEquals("NOT_WAITING_FOR_CODE", e.code)
    assertEquals("There is no email code to enter. Turn on email recovery first.", e.message)
  }

  @Test fun anUnrelatedIllegalArgumentPassesThroughUnchanged() {
    val other = IllegalArgumentException("something else")
    assertSame(other, assertThrows(IllegalArgumentException::class.java) { syncCall { throw other } })
  }
}
