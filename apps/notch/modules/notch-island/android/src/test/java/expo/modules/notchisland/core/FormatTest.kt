package expo.modules.notchisland.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FormatTest {
  @Test fun clockIn12And24Hour() {
    assertEquals("9:05", clockText(9, 5, "12"))
    assertEquals("21:05", clockText(21, 5, "24"))
    assertEquals("12:00", clockText(0, 0, "12"))
  }

  @Test fun noAlarmGivesNull() {
    assertNull(alarmLine(null, 0, "12"))
  }

  @Test fun dateReadsInPlainWords() {
    // Thursday, 19 November: Calendar gives DAY_OF_WEEK 5 (Thursday), month 10 (November).
    assertEquals("Thu 19 Nov", dateText(5, 19, 10))
  }

  @Test fun alarmShowsItsTimeInTheChosenStyle() {
    assertEquals("Alarm 07:00", alarmLine(7, 0, "24"))
    assertEquals("Alarm 7:00", alarmLine(7, 0, "12"))
  }

  @Test fun batteryIsClampedAndMarksCharging() {
    assertEquals("100%", batteryText(150, false))
    assertEquals("0%", batteryText(-3, false))
    assertEquals("82% charging", batteryText(82, true))
  }

  @Test fun durationText_minutes_and_hours() {
    assertEquals("00:00", durationText(0))
    assertEquals("03:12", durationText(192_000))
    assertEquals("1:02:05", durationText(3_725_000))
    assertEquals("00:00", durationText(-5))
  }
}
