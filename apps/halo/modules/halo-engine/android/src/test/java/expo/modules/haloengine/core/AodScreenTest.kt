package expo.modules.haloengine.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AodScreenTest {
  private fun note(key: String, pkg: String, at: Long, ongoing: Boolean = false, importance: Int = 3, summary: Boolean = false, secret: Boolean = false) =
    PostedNote(key, pkg, ongoing, importance, summary, null, at, secret = secret)

  @Test fun swipeLeftIsNextRightIsPrevious() {
    assertEquals(AodAction.NEXT, AodGestures.fling(onCard = true, pocket = false, dx = -200f, dy = 20f, minPx = 100f))
    assertEquals(AodAction.PREVIOUS, AodGestures.fling(onCard = true, pocket = false, dx = 200f, dy = -20f, minPx = 100f))
  }

  @Test fun shortVerticalOrOffCardSwipeDoesNothing() {
    assertEquals(AodAction.NONE, AodGestures.fling(onCard = true, pocket = false, dx = -50f, dy = 0f, minPx = 100f))
    assertEquals(AodAction.NONE, AodGestures.fling(onCard = true, pocket = false, dx = 150f, dy = 300f, minPx = 100f))
    assertEquals(AodAction.NONE, AodGestures.fling(onCard = false, pocket = false, dx = -300f, dy = 0f, minPx = 100f))
  }

  @Test fun tapsAndDoubleTaps() {
    assertEquals(AodAction.PLAY_PAUSE, AodGestures.singleTap(onCard = true, pocket = false, preview = false))
    assertEquals(AodAction.NONE, AodGestures.singleTap(onCard = false, pocket = false, preview = false))
    assertEquals(AodAction.LEAVE, AodGestures.singleTap(onCard = true, pocket = false, preview = true))
    assertEquals(AodAction.LEAVE, AodGestures.doubleTap(pocket = false))
  }

  @Test fun pocketIgnoresEveryTouch() {
    assertEquals(AodAction.NONE, AodGestures.singleTap(onCard = true, pocket = true, preview = false))
    assertEquals(AodAction.NONE, AodGestures.singleTap(onCard = true, pocket = true, preview = true))
    assertEquals(AodAction.NONE, AodGestures.doubleTap(pocket = true))
    assertEquals(AodAction.NONE, AodGestures.fling(onCard = true, pocket = true, dx = -300f, dy = 0f, minPx = 100f))
  }

  @Test fun pocketNearOnlyWhenCovered() {
    assertTrue(AodScreen.near(0f, 5f))
    assertFalse(AodScreen.near(5f, 5f))
    // Sensors with a large range report a real distance; only a few cm counts as covered.
    assertTrue(AodScreen.near(1f, 10f))
    assertFalse(AodScreen.near(8f, 10f))
  }

  @Test fun wakeShowsForItsOwnTenSeconds() {
    assertEquals(10_000L, AodScreen.timeoutMs(themeMs = null, wake = true))
    assertEquals(10_000L, AodScreen.timeoutMs(themeMs = 1_800_000L, wake = true))
    assertEquals(30_000L, AodScreen.timeoutMs(themeMs = 30_000L, wake = false))
    assertNull(AodScreen.timeoutMs(themeMs = null, wake = false))
  }

  @Test fun iconRowNewestAppFirstWithCounts() {
    val icons = NoteIcons("own.app")
    icons.posted(note("a1", "a", 1))
    icons.posted(note("b1", "b", 2))
    icons.posted(note("a2", "a", 3))
    assertEquals(listOf(IconCount("a", 2), IconCount("b", 1)), icons.top())
  }

  @Test fun iconRowSkipsWhatNeverFlashes() {
    val icons = NoteIcons("own.app")
    assertFalse(icons.posted(note("o", "own.app", 1)))
    assertFalse(icons.posted(note("g", "x", 1, ongoing = true)))
    assertFalse(icons.posted(note("s", "x", 1, importance = 2)))
    assertFalse(icons.posted(note("y", "x", 1, summary = true)))
    assertTrue(icons.top().isEmpty())
  }

  @Test fun iconRowCapsAtSixAndRemovesRead() {
    val icons = NoteIcons("own.app")
    for (i in 0 until 8) icons.posted(note("k$i", "p$i", i.toLong()))
    assertEquals((7 downTo 2).map { IconCount("p$it", 1) }, icons.top())
    assertTrue(icons.removed("k7"))
    assertFalse(icons.removed("k7"))
    assertEquals("p6", icons.top().first().pkg)
  }

  @Test fun iconRowResetReplacesAndStaysBounded() {
    val icons = NoteIcons("own.app", cap = 3)
    icons.posted(note("old", "old", 0))
    icons.reset((1..5).map { note("k$it", "p$it", it.toLong()) })
    assertEquals(listOf("p5", "p4", "p3"), icons.top().map { it.pkg })
    // A re-post of the same key is one notification, moved to the front.
    icons.posted(note("k3", "p3", 9))
    assertEquals(listOf(IconCount("p3", 1), IconCount("p5", 1), IconCount("p4", 1)), icons.top())
  }

  @Test fun iconRowSkipsSecretNotes() {
    val icons = NoteIcons("own.app")
    assertFalse(icons.posted(note("s", "bank", 1, secret = true)))
    assertTrue(icons.posted(note("p", "chat", 2)))
    assertEquals(listOf(IconCount("chat", 1)), icons.top())
  }

  @Test fun pocketEndsAfterThreeSeconds() {
    val p = PocketTimer()
    p.update(near = true, nowMs = 1_000)
    p.update(near = true, nowMs = 2_500) // a repeated near report does not restart the clock
    assertFalse(p.ended(3_999))
    assertTrue(p.ended(4_000))
  }

  @Test fun shortCoverDoesNotEnd() {
    val p = PocketTimer()
    p.update(near = true, nowMs = 0)
    p.update(near = false, nowMs = 2_000)
    assertFalse(p.ended(3_500))
    p.update(near = true, nowMs = 4_000)
    assertFalse(p.ended(6_999))
    assertTrue(p.ended(7_000))
  }

  @Test fun themeSwitchesOnlyWhenTheSlotChanges() {
    val themes = listOf(Theme("a", "A", "big-digits"), Theme("b", "B", "stacked"))
    val aod = SettingsAod(themeId = "a", slots = listOf(AodSlot("07:00", "a"), AodSlot("22:00", "b")))
    assertNull(AodScreen.switchTheme(aod, themes, 21 * 60 + 59, "a"))
    assertEquals("b", AodScreen.switchTheme(aod, themes, 22 * 60, "a")?.id)
    assertNull(AodScreen.switchTheme(aod, themes, 22 * 60 + 1, "b"))
  }
}
