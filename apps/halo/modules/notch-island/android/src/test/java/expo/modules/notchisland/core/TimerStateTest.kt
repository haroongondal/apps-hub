package expo.modules.notchisland.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TimerStateTest {
  @Test fun countdown_counts_down_while_running() {
    assertEquals(270_000L, TimerState(TimerMode.COUNTDOWN, 300_000).start(1000).remaining(31_000))
  }

  @Test fun pause_keeps_elapsed_and_resume_adds() {
    val s = TimerState(TimerMode.STOPWATCH, 0).start(0).pause(10_000).start(50_000)
    assertEquals(20_000L, s.elapsed(60_000))
  }

  @Test fun countdown_done_at_duration_and_pause_holds_it() {
    val s = TimerState(TimerMode.COUNTDOWN, 300_000).start(0)
    assertTrue(s.done(300_000))
    assertEquals(300_000L, s.pause(300_000).elapsed(900_000))
  }

  @Test fun stopwatch_is_never_done_and_has_no_remaining() {
    val s = TimerState(TimerMode.STOPWATCH, 0).start(0)
    assertFalse(s.done(10_000_000))
    assertEquals(0L, s.remaining(10_000_000))
  }

  @Test fun reset_clears_to_zero_and_stops() {
    val s = TimerState(TimerMode.COUNTDOWN, 300_000).start(0).reset()
    assertEquals(0L, s.elapsed(999))
    assertFalse(s.running)
  }

  @Test fun elapsed_never_negative_when_clock_goes_back() {
    assertEquals(0L, TimerState(TimerMode.STOPWATCH, 0).start(5_000).elapsed(1_000))
  }
}
