package expo.modules.deputyagent.core

import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceRulesTest {
  private val screen = Bounds(0, 0, 1000, 2000)
  private val send = NodeRef("com.chat", "Send", null, null, "id/send", Bounds(0, 0, 10, 10), clickable = true, depth = 3)

  @Test fun aSwipeCrossesTheMiddleTowardsItsDirection() {
    assertEquals(listOf(500, 1600, 500, 400), DeviceRules.line(screen, Direction.UP).toList())
    assertEquals(listOf(800, 1000, 200, 1000), DeviceRules.line(screen, Direction.LEFT).toList())
  }

  @Test fun scrollingDownMovesTheFingerUp() {
    assertEquals(DeviceRules.line(screen, Direction.UP).toList(), DeviceRules.scrollLine(screen, Direction.DOWN).toList())
    assertEquals(DeviceRules.line(screen, Direction.LEFT).toList(), DeviceRules.scrollLine(screen, Direction.RIGHT).toList())
  }

  @Test fun aFrameIsBlankOnlyWhenEverySampleIsNearBlack() {
    assertTrue(DeviceRules.isBlank(intArrayOf(0xFF000000.toInt(), 0xFF050505.toInt())))
    assertFalse(DeviceRules.isBlank(intArrayOf(0xFF000000.toInt(), 0xFF000080.toInt())))
    assertFalse(DeviceRules.isBlank(intArrayOf()))
  }

  @Test fun theLiveNodeIsFoundByWhereItIsNotByWhatTheObservationShowed() {
    val raw = listOf(send.copy(depth = 2), send)
    assertEquals(1, DeviceRules.find(raw, send.copy(text = null, childText = "Send")))
    assertNull(DeviceRules.find(raw, send.copy(bounds = Bounds(0, 0, 10, 11))))
  }

  @Test fun aNodeIsStaleWhenItsIdTextDescriptionOrBoundsChanged() {
    assertFalse(DeviceRules.changed(send, send.copy(clickable = false, depth = 9)))
    assertTrue(DeviceRules.changed(send, send.copy(text = "Delete")))
    assertTrue(DeviceRules.changed(send, send.copy(desc = "Delete")))
    assertTrue(DeviceRules.changed(send, send.copy(viewId = "id/delete")))
    assertTrue(DeviceRules.changed(send, send.copy(bounds = Bounds(1, 0, 10, 10))))
  }

  @Test fun theNextAlarmNamesTheAppThatSetItUnlessThatAppIsBlocked() {
    assertEquals("none", DeviceRules.nextAlarm(null, "Islam360", blocked = false))
    assertEquals("Thursday 18:41, set by Islam360", DeviceRules.nextAlarm("Thursday 18:41", "Islam360", blocked = false))
    assertEquals("Thursday 18:41, set by another app", DeviceRules.nextAlarm("Thursday 18:41", "Vault", blocked = true))
    assertEquals("Thursday 18:41", DeviceRules.nextAlarm("Thursday 18:41", null, blocked = false))
  }

  @Test fun anApprovedElementIsFoundAgainByWhatItIsAfterItMoved() {
    val moved = send.copy(bounds = Bounds(0, 1800, 10, 1810), depth = 5)
    assertEquals(moved, DeviceRules.relocate(listOf(send.copy(text = "Archive"), moved), send))
    assertNull("two matches", DeviceRules.relocate(listOf(moved, moved.copy(bounds = Bounds(0, 0, 5, 5))), send))
    assertNull("another app", DeviceRules.relocate(listOf(moved.copy(pkg = "com.other")), send))
    assertNull("now editable", DeviceRules.relocate(listOf(moved.copy(editable = true)), send))
    val bare = send.copy(text = null, viewId = null)
    assertNull("nothing to know it by", DeviceRules.relocate(listOf(bare), bare))
  }

  @Test fun anApprovedElementMustMatchInEverythingButWhereItIs() {
    val moved = send.copy(bounds = Bounds(0, 1800, 10, 1810), depth = 5)
    listOf(moved.copy(desc = "Send to Bob"), moved.copy(checked = true), moved.copy(visible = false), moved.copy(hint = "h"), moved.copy(childText = "x"))
      .forEach { assertNull(it.toString(), DeviceRules.relocate(listOf(it), send)) }
  }

  @Test fun settleWaitsForQuietButNotForever() = runTest {
    var last = 0L
    val now = { testScheduler.currentTime }
    DeviceRules.settle({ last }, now)
    assertEquals(400L, now())

    val s = now()
    launch { delay(300); last = testScheduler.currentTime }
    DeviceRules.settle({ last }, now)
    assertEquals(s + 700, now())

    val busy = now()
    val events = launch { while (true) { last = testScheduler.currentTime; delay(100) } }
    DeviceRules.settle({ last }, now)
    assertEquals(busy + 3_000, now())
    events.cancel()
  }
}
