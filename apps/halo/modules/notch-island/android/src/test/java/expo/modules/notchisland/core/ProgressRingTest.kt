package expo.modules.notchisland.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProgressRingTest {
  private val own = "com.haroon.halo"
  private fun note(key: String, at: Long, progress: Int = 50, max: Int = 100, indeterminate: Boolean = false, pkg: String = "com.haroon.designeditor") =
    RingNote(key, pkg, progress, max, indeterminate, at)

  private fun ring() = ProgressRing(own)

  @Test fun mostRecentlyUpdatedWins() {
    val r = ring()
    r.posted(note("a", 100), ongoing = true, secret = false, now = 0)
    r.posted(note("b", 300, progress = 20), ongoing = true, secret = false, now = 0)
    r.posted(note("c", 200), ongoing = true, secret = false, now = 0)
    assertEquals(RingShown("b", "com.haroon.designeditor", 0.2f), r.shown(0))
    r.posted(note("a", 400, progress = 75), ongoing = true, secret = false, now = 0)
    assertEquals(RingShown("a", "com.haroon.designeditor", 0.75f), r.shown(0))
  }

  @Test fun tiesPickTheSameOneEveryTime() {
    val r = ring()
    r.posted(note("b", 100), ongoing = true, secret = false, now = 0)
    r.posted(note("a", 100), ongoing = true, secret = false, now = 0)
    assertEquals("b", r.shown(0)?.key)
    assertEquals("b", r.shown(1)?.key)
  }

  @Test fun emptyShowsNothing() {
    assertNull(ring().shown(0))
  }

  @Test fun maxZeroIsIgnoredUnlessIndeterminate() {
    val r = ring()
    r.posted(note("a", 100, progress = 5, max = 0), ongoing = true, secret = false, now = 0)
    r.posted(note("b", 50, progress = 5, max = -3), ongoing = true, secret = false, now = 0)
    assertNull(r.shown(0))
    r.posted(note("c", 10, progress = 0, max = 0, indeterminate = true), ongoing = true, secret = false, now = 0)
    assertEquals(RingShown("c", "com.haroon.designeditor", null), r.shown(0))
  }

  @Test fun indeterminateWinsOverNumbers() {
    val r = ring()
    r.posted(note("a", 1, progress = 40, max = 100, indeterminate = true), ongoing = true, secret = false, now = 0)
    assertNull(r.shown(0)?.fraction)
    assertEquals("a", r.shown(0)?.key)
  }

  @Test fun halosOwnNeverRings() {
    val r = ring()
    r.posted(note("a", 1, pkg = own), ongoing = true, secret = false, now = 0)
    assertNull(r.shown(0))
    assertFalse(r.qualifies(note("a", 1, pkg = own), ongoing = true, secret = false))
  }

  @Test fun secretOrNotOngoingNeverRings() {
    val r = ring()
    r.posted(note("a", 1), ongoing = true, secret = true, now = 0)
    r.posted(note("b", 1), ongoing = false, secret = false, now = 0)
    assertNull(r.shown(0))
    assertTrue(r.qualifies(note("c", 1), ongoing = true, secret = false))
  }

  @Test fun fractionClampsTo0Through1() {
    assertEquals(1f, ProgressRing.fraction(note("a", 1, progress = 250, max = 100)))
    assertEquals(0f, ProgressRing.fraction(note("a", 1, progress = -5, max = 100)))
    assertEquals(1f, ProgressRing.fraction(note("a", 1, progress = Int.MAX_VALUE, max = Int.MAX_VALUE)))
    assertEquals(0.5f, ProgressRing.fraction(note("a", 1, progress = 1, max = 2)))
    assertNull(ProgressRing.fraction(note("a", 1, progress = 1, max = 0)))
  }

  @Test fun removalFallsBackThenClears() {
    val r = ring()
    r.posted(note("a", 100), ongoing = true, secret = false, now = 0)
    r.posted(note("b", 300), ongoing = true, secret = false, now = 0)
    r.removed("b", 10)
    assertEquals("a", r.shown(10)?.key)
    r.removed("a", 20)
    assertNull(r.shown(20))
    r.removed("never-posted", 30)
    assertNull(r.shown(30))
  }

  @Test fun noLongerOngoingClears() {
    val r = ring()
    r.posted(note("a", 100, progress = 60), ongoing = true, secret = false, now = 0)
    r.posted(note("a", 200, progress = 60), ongoing = false, secret = false, now = 5)
    assertNull(r.shown(5))
  }

  @Test fun finishedRingHoldsThenClearsWhileStillPosted() {
    val r = ring()
    r.posted(note("a", 100, progress = 100), ongoing = true, secret = false, now = 1_000)
    assertEquals(1f, r.shown(1_000)?.fraction)
    // A repost at 100% does not restart the hold.
    r.posted(note("a", 200, progress = 100), ongoing = true, secret = false, now = 2_000)
    assertEquals(1f, r.shown(1_000 + ProgressRing.HOLD_MS - 1)?.fraction)
    assertNull(r.shown(1_000 + ProgressRing.HOLD_MS))
    assertNull(r.nextExpiry(1_000 + ProgressRing.HOLD_MS))
  }

  @Test fun finishedRingHoldsAfterRemovalThenClears() {
    val r = ring()
    r.posted(note("a", 100, progress = 100), ongoing = true, secret = false, now = 1_000)
    r.removed("a", 1_200)
    assertEquals(RingShown("a", "com.haroon.designeditor", 1f), r.shown(1_200))
    assertEquals(1_000 + ProgressRing.HOLD_MS, r.nextExpiry(1_200))
    assertNull(r.shown(1_000 + ProgressRing.HOLD_MS))
  }

  @Test fun finishedRingHoldsWhenItStopsBeingOngoing() {
    val r = ring()
    r.posted(note("a", 100, progress = 100), ongoing = true, secret = false, now = 1_000)
    r.posted(note("a", 200, progress = 100), ongoing = false, secret = false, now = 1_100)
    assertEquals(1f, r.shown(1_100)?.fraction)
    assertNull(r.shown(1_000 + ProgressRing.HOLD_MS))
  }

  @Test fun heldRingThenGivesWayToTheOlderRunningOne() {
    val r = ring()
    r.posted(note("old", 100, progress = 30), ongoing = true, secret = false, now = 0)
    r.posted(note("done", 200, progress = 100), ongoing = true, secret = false, now = 0)
    assertEquals("done", r.shown(0)?.key)
    assertEquals("old", r.shown(ProgressRing.HOLD_MS)?.key)
  }

  @Test fun droppingBelowFullStartsANewHoldNextTime() {
    val r = ring()
    r.posted(note("a", 100, progress = 100), ongoing = true, secret = false, now = 0)
    r.posted(note("a", 200, progress = 10), ongoing = true, secret = false, now = 5_000)
    assertEquals(0.1f, r.shown(5_000)?.fraction)
    assertNull(r.nextExpiry(5_000))
    r.posted(note("a", 300, progress = 100), ongoing = true, secret = false, now = 6_000)
    assertEquals(1f, r.shown(6_000 + ProgressRing.HOLD_MS - 1)?.fraction)
    assertNull(r.shown(6_000 + ProgressRing.HOLD_MS))
  }

  @Test fun removingAnExpiredFinishedRingDoesNotBringItBack() {
    val r = ring()
    r.posted(note("a", 100, progress = 100), ongoing = true, secret = false, now = 0)
    r.removed("a", ProgressRing.HOLD_MS + 10)
    assertNull(r.shown(ProgressRing.HOLD_MS + 10))
  }

  @Test fun clearForgetsEverything() {
    val r = ring()
    r.posted(note("a", 100), ongoing = true, secret = false, now = 0)
    r.clear()
    assertNull(r.shown(0))
  }
}
