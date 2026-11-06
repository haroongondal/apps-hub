package expo.modules.opentunnelnative.firewall

import org.junit.Assert.assertEquals
import org.junit.Test

class LogRetentionTest {

  private val now = 1_000_000_000_000L
  private val day = 24 * 3600 * 1000L

  @Test
  fun dropsRowsOlderThanSevenDays() {
    // Rows at now-8d and now-1d: returns only the 8-day id.
    val rows = listOf(1L to now - 8 * day, 2L to now - 1 * day)
    assertEquals(listOf(1L), LogRetention.idsToDelete(rows, now))
  }

  @Test
  fun keepsAtMost100kNewestRows() {
    // 100_001 fresh rows: returns exactly the oldest 1 id.
    val rows = (1L..100_001L).map { it to now - 1000 + it }
    assertEquals(listOf(1L), LogRetention.idsToDelete(rows, now))
  }

  @Test
  fun ageLimitWinsWhenItHitsFirst() {
    // 2 old rows + 10 new: returns the 2 old ids.
    val old = listOf(1L to now - 9 * day, 2L to now - 8 * day)
    val fresh = (3L..12L).map { it to now - 1000 + it }
    assertEquals(listOf(1L, 2L), LogRetention.idsToDelete(old + fresh, now))
  }
}
