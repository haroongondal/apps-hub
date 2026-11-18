package expo.modules.notchisland.core

import org.junit.Assert.assertEquals
import org.junit.Test

class RowsTest {
  @Test fun rowsFor_keeps_only_media_and_timer_in_order() {
    assertEquals(listOf("timer", "media"), rowsFor(listOf("timer", "clock", "media", "battery")))
    assertEquals(emptyList<String>(), rowsFor(listOf("clock", "battery")))
  }
}
