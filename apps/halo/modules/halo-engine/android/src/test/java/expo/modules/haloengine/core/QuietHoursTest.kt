package expo.modules.haloengine.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QuietHoursTest {
  private fun m(h: Int, min: Int = 0) = h * 60 + min

  @Test
  fun crossesMidnight() {
    for (t in listOf(m(22), m(23, 59), m(0), m(3), m(6, 59))) assertTrue("$t", QuietHours.active(true, "22:00", "07:00", t))
    for (t in listOf(m(7), m(12), m(21, 59))) assertFalse("$t", QuietHours.active(true, "22:00", "07:00", t))
  }

  @Test
  fun equalMeansOff() {
    for (t in listOf(0, m(7), m(12), m(23, 59))) assertFalse("$t", QuietHours.active(true, "07:00", "07:00", t))
  }

  @Test
  fun insideAndOutsideWindow() {
    assertTrue(QuietHours.active(true, "13:00", "14:30", m(13)))
    assertTrue(QuietHours.active(true, "13:00", "14:30", m(14, 29)))
    assertFalse(QuietHours.active(true, "13:00", "14:30", m(14, 30)))
    assertFalse(QuietHours.active(true, "13:00", "14:30", m(12, 59)))
    assertFalse(QuietHours.active(false, "13:00", "14:30", m(13, 30)))
  }

  @Test
  fun malformedTimesAreOff() {
    assertFalse(QuietHours.active(true, "soon", "07:00", m(3)))
    assertFalse(QuietHours.active(true, "22:00", "", m(23)))
  }
}
