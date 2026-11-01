package expo.modules.designmedia.core

import org.junit.Assert.assertEquals
import org.junit.Test

class DisplayTest {
  @Test
  fun `a portrait phone recording is reported with its displayed size`() {
    assertEquals(1080 to 1920, displaySize(1920, 1080, 90))
    assertEquals(1080 to 1920, displaySize(1920, 1080, 270))
  }

  @Test
  fun `an upright or upside-down frame keeps its size`() {
    assertEquals(1920 to 1080, displaySize(1920, 1080, 0))
    assertEquals(1920 to 1080, displaySize(1920, 1080, 180))
  }
}
