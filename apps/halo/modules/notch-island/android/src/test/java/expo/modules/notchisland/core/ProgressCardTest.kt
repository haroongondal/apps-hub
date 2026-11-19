package expo.modules.notchisland.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProgressCardTest {
  private fun snap(key: String, at: Long, percent: Int? = 50) = ProgressSnapshot(key, "com.example", "Delivering - 12 min", percent, at)

  @Test fun newestWins() {
    val a = snap("a", 100)
    val b = snap("b", 300)
    val c = snap("c", 200)
    assertEquals(b, Progress.newest(listOf(a, b, c)))
    assertNull(Progress.newest(emptyList()))
  }

  @Test fun removalFallsBackThenClears() {
    val all = mutableMapOf("a" to snap("a", 100), "b" to snap("b", 300))
    all.remove("b")
    assertEquals("a", Progress.newest(all.values)?.key)
    all.remove("a")
    assertNull(Progress.newest(all.values))
  }

  @Test fun percentClampsTo0Through100() {
    assertEquals(45, Progress.percent(45, 100, false))
    assertEquals(50, Progress.percent(1, 2, false))
    assertEquals(100, Progress.percent(250, 100, false))
    assertEquals(0, Progress.percent(-5, 100, false))
    assertEquals(100, Progress.percent(Int.MAX_VALUE, Int.MAX_VALUE, false))
    assertEquals("Shop  ·  100%", Progress.text(snap("a", 1, percent = 140), "Shop").subtitle)
  }

  @Test fun indeterminateHasNoPercent() {
    assertNull(Progress.percent(10, 100, true))
    assertNull(Progress.percent(10, 0, false))
    val t = Progress.text(snap("a", 1, percent = null), "Maps")
    assertEquals("Delivering - 12 min", t.title)
    assertEquals("Maps", t.subtitle)
  }

  @Test fun textKeepsTitleOnOneLine() {
    val t = Progress.text(snap("a", 1).copy(title = "  Arriving\nin 3 min "), "Rides")
    assertEquals("Arriving in 3 min", t.title)
    assertEquals("Rides  ·  50%", t.subtitle)
  }

  @Test fun qualifiesOnlyOngoingProgressOrNavigation() {
    assertTrue(Progress.qualifies(ongoing = true, category = null, progressMax = 100, ownCard = false))
    assertTrue(Progress.qualifies(ongoing = true, category = "progress", progressMax = 0, ownCard = false))
    assertTrue(Progress.qualifies(ongoing = true, category = "navigation", progressMax = 0, ownCard = false))
    assertFalse(Progress.qualifies(ongoing = false, category = "progress", progressMax = 100, ownCard = false))
    assertFalse(Progress.qualifies(ongoing = true, category = "msg", progressMax = 0, ownCard = false))
    assertFalse(Progress.qualifies(ongoing = true, category = null, progressMax = 0, ownCard = false))
  }

  @Test fun mediaCallsAndAlarmsNeverQualify() {
    assertFalse(Progress.qualifies(ongoing = true, category = null, progressMax = 100, ownCard = true))
    assertFalse(Progress.qualifies(ongoing = true, category = "transport", progressMax = 100, ownCard = false))
    assertFalse(Progress.qualifies(ongoing = true, category = "call", progressMax = 100, ownCard = false))
    assertFalse(Progress.qualifies(ongoing = true, category = "alarm", progressMax = 100, ownCard = false))
  }

  @Test fun callHidesCardMediaAndTimerStayAbove() {
    val p = snap("a", 1)
    assertFalse(Progress.show(true, p, listOf("call", "media")))
    assertTrue(Progress.show(true, p, listOf("media", "timer")))
    assertTrue(Progress.show(true, p, emptyList()))
    assertFalse(Progress.show(false, p, emptyList()))
    assertFalse(Progress.show(true, null, emptyList()))
  }
}
