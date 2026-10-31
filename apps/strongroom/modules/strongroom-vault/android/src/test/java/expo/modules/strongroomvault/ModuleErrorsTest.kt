package expo.modules.strongroomvault

import expo.modules.kotlin.exception.CodedException
import expo.modules.strongroomvault.core.KdfOutOfRange
import expo.modules.strongroomvault.core.KdfParams
import expo.modules.strongroomvault.core.MemoryRecordStore
import expo.modules.strongroomvault.core.Vault
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
}
