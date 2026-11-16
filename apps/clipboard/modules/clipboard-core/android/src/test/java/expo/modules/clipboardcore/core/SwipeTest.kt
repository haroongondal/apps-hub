package expo.modules.clipboardcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SwipeTest {
  @Test fun `short slow drag springs back`() {
    assertEquals(0, Swipe.direction(100f, 200f, 400))
    assertEquals(0, Swipe.direction(-100f, -200f, 400))
  }

  @Test fun `past a third of the row deletes toward the drag`() {
    assertEquals(1, Swipe.direction(150f, 0f, 400))
    assertEquals(-1, Swipe.direction(-150f, 0f, 400))
  }

  @Test fun `a fling deletes even when short`() {
    assertEquals(1, Swipe.direction(40f, 1500f, 400))
    assertEquals(-1, Swipe.direction(0f, -1500f, 400))
  }

  @Test fun `only clearly sideways drags swipe`() {
    assertTrue(Swipe.isSwipe(30f, 5f, 12))
    assertFalse(Swipe.isSwipe(8f, 0f, 12))
    assertFalse(Swipe.isSwipe(30f, 20f, 12))
  }

  @Test fun `ages`() {
    assertEquals("just now", Swipe.ago(0, 30_000))
    assertEquals("5 min ago", Swipe.ago(0, 5 * 60_000))
    assertEquals("3 h ago", Swipe.ago(0, 3 * 3_600_000))
    assertEquals("2 d ago", Swipe.ago(0, 2 * 86_400_000))
  }
}
