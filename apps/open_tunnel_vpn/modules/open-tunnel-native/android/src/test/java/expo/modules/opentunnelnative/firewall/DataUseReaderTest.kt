package expo.modules.opentunnelnative.firewall

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DataUseReaderTest {

  @Test
  fun mergesRowsOfTheSameUid() {
    val rows = DataUseReader.rows(listOf(Triple(10_001, 100L, 0L), Triple(10_001, 0L, 30L), Triple(10_001, 5L, 0L)))
    assertEquals(listOf(DataUseRow(10_001, 105L, 30L)), rows)
  }

  @Test
  fun dropsUidsThatUsedNothing() {
    val rows = DataUseReader.rows(listOf(Triple(10_001, 0L, 0L), Triple(10_002, 0L, 7L)))
    assertEquals(listOf(DataUseRow(10_002, 0L, 7L)), rows)
  }

  @Test
  fun keepsWifiAndCellularSeparate() {
    val rows = DataUseReader.rows(listOf(Triple(10_001, 1_000L, 0L), Triple(10_002, 0L, 2_000L)))
    assertEquals(listOf(DataUseRow(10_001, 1_000L, 0L), DataUseRow(10_002, 0L, 2_000L)), rows)
  }

  @Test
  fun anEmptyInputIsEmpty() {
    assertTrue(DataUseReader.rows(emptyList()).isEmpty())
  }
}
