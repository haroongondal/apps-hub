package expo.modules.placereminders.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RulesTest {
  @Test fun arriveFiresOnlyWhenEntering() {
    assertTrue(shouldNotify("arrive", entering = true))
    assertFalse(shouldNotify("arrive", entering = false))
  }

  @Test fun leaveFiresOnlyWhenLeaving() {
    assertFalse(shouldNotify("leave", entering = true))
    assertTrue(shouldNotify("leave", entering = false))
  }

  @Test fun unknownTriggerNeverFires() {
    assertFalse(shouldNotify("both", entering = true))
    assertFalse(shouldNotify("both", entering = false))
  }

  @Test fun radiusIsClampedToWhatAndroidRespects() {
    assertEquals(100f, radiusFor(10), 0f)
    assertEquals(250f, radiusFor(250), 0f)
    assertEquals(5000f, radiusFor(60_000), 0f)
  }
}
