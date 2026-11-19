package expo.modules.notchisland.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AlarmCardTest {
  private fun snap(key: String, postedAt: Long) = AlarmSnapshot(key, "Alarm", 0, postedAt, 0, 1)

  @Test fun ringingNeedsAlarmCategoryAndOngoingOrFullScreen() {
    assertTrue(AlarmCard.ringing("alarm", ongoing = true, fullScreen = false))
    assertTrue(AlarmCard.ringing("alarm", ongoing = false, fullScreen = true))
    assertFalse(AlarmCard.ringing("alarm", ongoing = false, fullScreen = false))
    assertFalse(AlarmCard.ringing("call", ongoing = true, fullScreen = true))
    assertFalse(AlarmCard.ringing(null, ongoing = true, fullScreen = true))
  }

  @Test fun actionsMatchTitlesInAnyOrder() {
    assertEquals(AlarmActions(0, 1), AlarmCard.actions(listOf("Snooze", "Dismiss")))
    assertEquals(AlarmActions(1, 0), AlarmCard.actions(listOf("Stop", "Snooze")))
    assertEquals(AlarmActions(1, 0), AlarmCard.actions(listOf("Ausschalten", "Schlummern")))
    assertEquals(AlarmActions(0, 1), AlarmCard.actions(listOf("スヌーズ", "停止")))
    assertEquals(AlarmActions(0, 2), AlarmCard.actions(listOf("SNOOZE", "Edit", "Turn off")))
  }

  @Test fun semanticDeleteWinsForDismiss() {
    assertEquals(AlarmActions(0, 2), AlarmCard.actions(listOf("Snooze", "Stop", "X"), listOf(0, 0, 4)))
    assertEquals(AlarmActions(0, 1), AlarmCard.actions(listOf("Snooze", "Stop"), listOf(4, 0)))
  }

  @Test fun unknownTitlesFallBackToTheFirstTwoSnoozeFirst() {
    assertEquals(AlarmActions(0, 1), AlarmCard.actions(listOf("Foo", "Bar", "Baz")))
    assertEquals(AlarmActions(1, 0), AlarmCard.actions(listOf("Dismiss", "Foo")))
    assertEquals(AlarmActions(0, 1), AlarmCard.actions(listOf("Snooze", "Foo")))
    assertEquals(AlarmActions(0, 3), AlarmCard.actions(listOf("Foo", "Bar", "Baz", "Dismiss")))
  }

  @Test fun oneOrNoActionHidesWhatIsNotFound() {
    assertEquals(AlarmActions(-1, 0), AlarmCard.actions(listOf("Dismiss")))
    assertEquals(AlarmActions(-1, -1), AlarmCard.actions(listOf("Foo")))
    assertEquals(AlarmActions(-1, -1), AlarmCard.actions(emptyList()))
  }

  @Test fun newestAlarmWinsAndShowFollowsTheSwitch() {
    assertEquals("b", AlarmCard.pick(listOf(snap("a", 100), snap("b", 300), snap("c", 200)))?.key)
    assertNull(AlarmCard.pick(emptyList()))
    assertTrue(AlarmCard.show(true, snap("a", 1)))
    assertFalse(AlarmCard.show(false, snap("a", 1)))
    assertFalse(AlarmCard.show(true, null))
  }

  @Test fun titleFallsBackToAlarm() {
    assertEquals("Wake up now", AlarmCard.title("  Wake up\n now "))
    assertEquals("Alarm", AlarmCard.title(null))
    assertEquals("Alarm", AlarmCard.title("   "))
  }
}
