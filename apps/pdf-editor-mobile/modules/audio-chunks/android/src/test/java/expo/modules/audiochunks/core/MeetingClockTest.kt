package expo.modules.audiochunks.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MeetingClockTest {
  @Test
  fun elapsedRunsFromTheStartAndFreezesAtStop() {
    val clock = MeetingClock(10_000)
    assertEquals(0L, clock.elapsedMs(10_000))
    assertEquals(3_600_000L, clock.elapsedMs(3_610_000))
    clock.stop(3_610_000)
    assertEquals(3_600_000L, clock.elapsedMs(9_999_999))
    assertEquals(0L, MeetingClock(10_000).elapsedMs(5_000)) // a clock read before the start never goes negative
  }

  @Test
  fun addsUpEverySilencedSpan() {
    val clock = MeetingClock(0)
    clock.setSilenced(true, 1_000)
    assertTrue(clock.silenced)
    assertEquals(500L, clock.silencedMs(1_500))
    clock.setSilenced(true, 1_800) // a repeat while silenced keeps the first start
    clock.setSilenced(false, 2_000)
    assertFalse(clock.silenced)
    clock.setSilenced(false, 2_500) // a repeat while not silenced adds nothing
    clock.setSilenced(true, 5_000)
    clock.setSilenced(false, 5_250)
    assertEquals(1_250L, clock.silencedMs(9_000))
  }

  @Test
  fun stopClosesAnOpenSilenceAndIgnoresLaterChanges() {
    val clock = MeetingClock(0)
    clock.setSilenced(true, 4_000)
    clock.stop(7_000)
    assertFalse(clock.silenced)
    assertEquals(3_000L, clock.silencedMs(20_000))
    clock.setSilenced(true, 8_000)
    clock.stop(9_000)
    assertEquals(3_000L, clock.silencedMs(20_000))
    assertEquals(7_000L, clock.elapsedMs(20_000))
  }
}
