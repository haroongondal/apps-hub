package expo.modules.inflowcore.core

import org.junit.Assert.assertFalse
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
  }
}
