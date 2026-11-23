package expo.modules.haloengine.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LinkTimingTest {
  private val t = 1_000_000L

  @Test fun theTimesAreTheOnesTheOwnerWasPromised() {
    assertEquals(5_000L, RereadGate.SETTLE_MS)
    assertEquals(60_000L, RereadGate.MIN_GAP_MS)
    assertEquals(15 * 60_000L, RereadGate.STALE_MS)
    assertEquals(10 * 60_000L, LinkPulse.WAITING_EVERY_MS)
  }

  @Test fun aBurstOfPingsGivesOneReadFiveSecondsAfterTheFirst() {
    val g = RereadGate()
    assertEquals(t + RereadGate.SETTLE_MS, g.onPing(t))
    assertNull(g.onPing(t + 1_000))
    assertNull(g.onPing(t + 4_000))
    assertNull(g.onOpen(t + 4_500))
  }

  @Test fun neverTwoReadsWithinAMinute() {
    val g = RereadGate()
    g.onRead(t)
    assertEquals(t + RereadGate.MIN_GAP_MS, g.onPing(t + 1_000))
    g.onRead(t + RereadGate.MIN_GAP_MS)
    assertEquals(t + RereadGate.MIN_GAP_MS + 70_000 + RereadGate.SETTLE_MS, g.onPing(t + RereadGate.MIN_GAP_MS + 70_000))
  }

  @Test fun anAppOpenReadsAtOnceUnlessARecentReadCoversIt() {
    val g = RereadGate()
    assertEquals(t, g.onOpen(t))
    g.onRead(t)
    assertEquals(t + RereadGate.MIN_GAP_MS, g.onOpen(t + 10_000))
  }

  @Test fun theAlwaysOnScreenRereadsOnlyDataOlderThanFifteenMinutes() {
    val g = RereadGate()
    assertEquals(t, g.onStale(t))
    g.onRead(t)
    assertNull(g.onStale(t + RereadGate.STALE_MS - 1))
    assertEquals(t + RereadGate.STALE_MS, g.onStale(t + RereadGate.STALE_MS))
  }

  @Test fun theRedPulseShowsAtOnceThenEveryFiveMinutesWhileTrue() {
    var st = LinkPulse.step(PulseState(), shield = true, waiting = false, quiet = false, now = t)
    assertEquals(PulseKind.SHIELD, st.show)
    assertEquals(t + LinkPulse.SHIELD_EVERY_MS, st.nextAt)
    st = LinkPulse.step(st.state, shield = true, waiting = false, quiet = false, now = t + 60_000)
    assertNull(st.show)
    st = LinkPulse.step(st.state, shield = true, waiting = false, quiet = false, now = t + LinkPulse.SHIELD_EVERY_MS)
    assertEquals(PulseKind.SHIELD, st.show)
  }

  @Test fun nothingToPulseMeansNoTimer() {
    val st = LinkPulse.step(PulseState(t, t), shield = false, waiting = false, quiet = false, now = t + 1)
    assertNull(st.show)
    assertNull(st.nextAt)
    assertEquals(PulseState(), st.state)
  }

  @Test fun aPulseThatEndsAndComesBackShowsAtOnce() {
    val on = LinkPulse.step(PulseState(), shield = true, waiting = false, quiet = false, now = t)
    val off = LinkPulse.step(on.state, shield = false, waiting = false, quiet = false, now = t + 1_000)
    assertEquals(PulseKind.SHIELD, LinkPulse.step(off.state, shield = true, waiting = false, quiet = false, now = t + 2_000).show)
  }

  @Test fun redComesFirstAndTheWaitingPulseFollowsShortlyAfter() {
    val both = LinkPulse.step(PulseState(), shield = true, waiting = true, quiet = false, now = t)
    assertEquals(PulseKind.SHIELD, both.show)
    assertEquals(t + LinkPulse.BUMPED_MS, both.nextAt)
    val next = LinkPulse.step(both.state, shield = true, waiting = true, quiet = false, now = t + LinkPulse.BUMPED_MS)
    assertEquals(PulseKind.WAITING, next.show)
    assertEquals(t + LinkPulse.SHIELD_EVERY_MS, next.nextAt)
  }

  @Test fun quietHoursAndADarkScreenShowNothingButKeepChecking() {
    val st = LinkPulse.step(PulseState(), shield = false, waiting = true, quiet = true, now = t)
    assertNull(st.show)
    assertEquals(t + LinkPulse.WAITING_EVERY_MS, st.nextAt)
    assertEquals(PulseKind.WAITING, LinkPulse.step(st.state, shield = false, waiting = true, quiet = false, now = st.nextAt!!).show)
  }
}
