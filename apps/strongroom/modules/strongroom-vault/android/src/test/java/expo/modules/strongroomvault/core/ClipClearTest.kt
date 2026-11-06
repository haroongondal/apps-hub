package expo.modules.strongroomvault.core

import expo.modules.strongroomvault.core.ClipClear.Step
import org.junit.Assert.assertEquals
import org.junit.Test

class ClipClearTest {
  @Test fun dueClearWipesStrongroomsClip() {
    assertEquals(Step.CLEAR, ClipClear.due("t", "t"))
  }

  @Test fun dueClearKeepsWhatTheOwnerCopiedSinceWhenItCanSeeIt() {
    assertEquals(Step.FORGET, ClipClear.due("t", ""))
  }

  @Test fun dueClearInTheBackgroundWipesWithoutLooking() {
    assertEquals(Step.CLEAR, ClipClear.due("t", null))
  }

  @Test fun nothingOnRecordTouchesNothing() {
    assertEquals(Step.NOTHING, ClipClear.due(null, null))
    assertEquals(Step.NOTHING, ClipClear.due(null, "t"))
    assertEquals(Step.NOTHING, ClipClear.focused(null, "t", 0, 60_000))
  }

  @Test fun focusedCheckWipesAnOverdueClipOnlyIfItIsStrongrooms() {
    assertEquals(Step.CLEAR, ClipClear.focused("t", "t", 0, 30_000))
    assertEquals(Step.CLEAR, ClipClear.focused("t", "t", 0, 3_600_000))
    assertEquals(Step.FORGET, ClipClear.focused("t", "", 0, 3_600_000))
  }

  @Test fun focusedCheckNeverWipesAClipItCannotSee() {
    assertEquals(Step.NOTHING, ClipClear.focused("t", null, 0, 3_600_000))
  }

  @Test fun focusedCheckBeforeTheDeadlineWaitsForTheRest() {
    assertEquals(Step.WAIT, ClipClear.focused("t", "t", 0, 29_999))
    assertEquals(20_000L, ClipClear.left(0, 10_000))
  }

  @Test fun aClockThatMovedBackwardsWaitsNoMoreThanTheFullTime() {
    assertEquals(Step.WAIT, ClipClear.focused("t", "t", 10_000, 0))
    assertEquals(30_000L, ClipClear.left(10_000, 0))
  }
}
