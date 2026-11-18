package expo.modules.notchisland.core

import org.junit.Assert.assertEquals
import org.junit.Test

class EarLayoutTest {
  @Test fun bothWidgetsFillTheEarsAndTheDateLine() {
    assertEquals(Ears(time = true, battery = true, dateLine = true), earLayout(listOf("clock", "battery")))
  }

  @Test fun batteryAloneLeavesTheLeftEarEmptyAndNoDateLine() {
    assertEquals(Ears(time = false, battery = true, dateLine = false), earLayout(listOf("battery")))
  }

  @Test fun nothingEnabledShowsNoEars() {
    assertEquals(Ears(time = false, battery = false, dateLine = false), earLayout(emptyList()))
  }
}
