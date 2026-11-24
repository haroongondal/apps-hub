package expo.modules.inflowcore.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AppHealthTest {
  /** Counts the writes that reach the store. */
  private class WriteCounting(private val inner: MemoryItemStore) : ItemStore by inner {
    var writes = 0
    override fun setMeta(key: String, value: String) {
      writes++
      inner.setMeta(key, value)
    }
  }

  @Test fun theRowHasOneValuePerColumnAndNoAccessibility() {
    val row = AppHealth.row(listenerEnabled = true, anyKeySaved = true, lastSeenAt = 5L)
    assertEquals(AppHealth.COLUMNS.size, row.size)
    assertArrayEquals(arrayOf<Any?>("inflow", null, 1, "own", 5L), row)
  }

  @Test fun listenerOffAndNoKeyGiveZeroAndNone() =
    assertArrayEquals(arrayOf<Any?>("inflow", null, 0, "none", null), AppHealth.row(false, false, null))

  @Test fun aiSourceIsTheRecordedSourceElseOwnAndNoneWithoutAKey() {
    for (keys in listOf(true, false)) assertEquals(if (keys) "own" else "none", AppHealth.row(true, keys, null)[3])
    assertEquals("hub", AppHealth.row(true, true, null, "hub")[3])
    assertEquals("own", AppHealth.row(true, true, null, "own")[3])
    assertEquals("own", AppHealth.row(true, true, null, "garbage")[3])
    assertEquals("none", AppHealth.row(true, false, null, "hub")[3])
  }

  @Test fun theRecorderWritesOnlyWhenTheSourceChanges() {
    val store = WriteCounting(MemoryItemStore())
    AppHealth.record(store, "hub")
    AppHealth.record(store, "hub")
    assertEquals(1, store.writes)
    AppHealth.record(store, "own")
    assertEquals(2, store.writes)
    assertEquals("own", store.meta(AppHealth.META_AI_SOURCE))
  }

  @Test fun onlyTheHeartbeatWritesAndReadingOrBuildingTheRowDoesNot() {
    val store = WriteCounting(MemoryItemStore())
    assertNull(AppHealth.lastSeen(store))
    AppHealth.row(true, false, AppHealth.lastSeen(store))
    assertEquals(0, store.writes)
    AppHealth.beat(store, 1_700_000_000_000L)
    assertEquals(1, store.writes)
    assertEquals(1_700_000_000_000L, AppHealth.lastSeen(store))
    AppHealth.row(true, false, AppHealth.lastSeen(store))
    assertEquals(1, store.writes)
  }

  @Test fun aBrokenSavedValueReadsAsNeverSeen() {
    val store = MemoryItemStore().also { it.setMeta(AppHealth.META_LAST_SEEN, "not a number") }
    assertNull(AppHealth.lastSeen(store))
  }
}
