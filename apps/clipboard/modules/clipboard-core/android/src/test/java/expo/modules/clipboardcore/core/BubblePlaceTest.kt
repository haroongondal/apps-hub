package expo.modules.clipboardcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BubblePlaceTest {
  private val screenW = 1080
  private val screenH = 2400
  private val above = 900 // keyboard height
  private val size = 132

  @Test fun `a finger moving left and up grows the distances`() {
    assertEquals(160 to 272, BubblePlace.dragged(88, 200, -72f, -72f))
    assertEquals(16 to 128, BubblePlace.dragged(88, 200, 72f, 72f))
  }

  @Test fun `a sub-pixel finger rounds to whole pixels`() {
    assertEquals(88 to 200, BubblePlace.dragged(88, 200, 0.4f, 0.4f))
  }

  @Test fun `the bubble stays fully on screen`() {
    val (dx, dy) = BubblePlace.clamped(10_000, 10_000, screenW, above, screenH, size)
    assertEquals(screenW - size, dx)
    assertEquals(screenH - above - size, dy)
  }

  @Test fun `the bubble never sinks under the keyboard`() {
    assertEquals(0, BubblePlace.clamped(-10_000, -10_000, screenW, above, screenH, size).second)
  }

  @Test fun `a tiny screen keeps the clamp whole`() {
    val (dx, dy) = BubblePlace.clamped(500, 500, 100, above, 1000, size)
    assertEquals(0, dx)
    assertEquals(0, dy)
  }

  @Test fun `a parked spot survives a taller keyboard`() {
    // parked 200 px above a 900 px keyboard; an emoji panel makes the keyboard 1 200 px
    val (_, dy) = BubblePlace.clamped(500, 200, screenW, 1200, screenH, size)
    assertEquals(200, dy) // still measured from the keyboard top, so it stays above it
  }

  @Test fun `the bubble stays under the status bar`() {
    val (_, dy) = BubblePlace.clamped(500, 10_000, screenW, above, screenH, size, top = 96)
    assertEquals(screenH - above - size - 96, dy)
  }

  @Test fun `any direction past the slop drags`() {
    assertTrue(BubblePlace.isDrag(30f, 0f, 12))
    assertTrue(BubblePlace.isDrag(0f, 30f, 12))
    assertFalse(BubblePlace.isDrag(8f, 4f, 12))
  }
}
