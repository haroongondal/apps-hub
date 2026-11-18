package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FastPathTest {
  private val t = 1_000_000L

  @Test fun noArrivalIsNeverDue() = assertFalse(FastPath.due(null, null, t))

  @Test fun waitsForTheQuietWindow() {
    assertFalse(FastPath.due(t, null, t + 44_999))
    assertTrue(FastPath.due(t, null, t + 45_000))
  }

  @Test fun atMostOneRunAMinute() {
    val arrival = t
    val now = t + 45_000
    assertFalse(FastPath.due(arrival, now - 59_999, now))
    assertTrue(FastPath.due(arrival, now - 60_000, now))
  }

  @Test fun aRunAfterTheArrivalIsNotRepeated() {
    // The arrival was already sent by the run at t+50 s: nothing new is waiting.
    assertFalse(FastPath.due(t, t + 50_000, t + 200_000))
  }

  @Test fun aPersonIsAPhoneNumber() {
    assertTrue(FastPath.isPerson("+923001234567"))
    assertTrue(FastPath.isPerson("03001234567"))
    assertFalse(FastPath.isPerson("8287"))
    assertFalse(FastPath.isPerson("12345"))
    assertFalse(FastPath.isPerson("123456"))
    assertFalse(FastPath.isPerson("JAZZ"))
    assertFalse(FastPath.isPerson("HBL-Alert"))
    assertFalse(FastPath.isPerson(null))
    assertFalse(FastPath.isPerson("+1234567890123456"))   // 16 digits
    assertFalse(FastPath.isPerson("+"))
    assertTrue(FastPath.isPerson("+92 300 1234567"))
    assertTrue(FastPath.isPerson("0300-1234567"))
    assertTrue(FastPath.isPerson("(0300) 1234567"))
    assertFalse(FastPath.isPerson("12-34"))
  }

  @Test fun waitMsSaysHowLongUntilTheRunAndNullWhenNothingWaits() {
    assertNull(FastPath.waitMs(null, null, t))
    assertEquals(45_000L, FastPath.waitMs(t, null, t))
    assertEquals(35_000L, FastPath.waitMs(t, null, t + 10_000))
    assertEquals(0L, FastPath.waitMs(t, null, t + 99_000))
    // The minute since the last run is the longer wait here: arrival t+10 s, run at t+5 s, now t+40 s -> quiet ends t+55 s, gap ends t+65 s.
    assertEquals(25_000L, FastPath.waitMs(t + 10_000, t + 5_000, t + 40_000))
    assertNull(FastPath.waitMs(t, t + 1, t + 100_000))   // the run already took this arrival
  }
}
