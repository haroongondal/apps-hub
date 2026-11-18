package expo.modules.pdfscan.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class SheetLayoutTest {
  private fun assertCardSize(r: IntArray) {
    assertTrue("width ${r[2] - r[0]}", abs(r[2] - r[0] - 1011) <= 1)
    assertTrue("height ${r[3] - r[1]}", abs(r[3] - r[1] - 637) <= 1)
  }

  @Test fun sheetIsA4At300Dpi() {
    assertEquals(2480, SheetLayout.WIDTH)
    assertEquals(3508, SheetLayout.HEIGHT)
  }

  @Test fun frontAboveBackCentred() {
    val (front, back) = SheetLayout.cardRects(true)
    for (r in listOf(front, back)) {
      assertCardSize(r)
      assertTrue("left ${r[0]} right ${2480 - r[2]}", abs(r[0] - (2480 - r[2])) <= 1)
    }
    assertEquals(118, back[1] - front[3])
    assertTrue("top ${front[1]} bottom ${3508 - back[3]}", abs(front[1] - (3508 - back[3])) <= 1)
  }

  @Test fun cardImagesAreLetterboxedAndPortraitOnesTurned() {
    val rect = SheetLayout.cardRects(false)[0]
    val (turnWide, wide) = SheetLayout.fit(1600, 800, rect)
    assertEquals(false, turnWide)
    assertEquals(rect[0], wide[0])
    assertEquals(1011, wide[2] - wide[0])
    assertTrue("height ${wide[3] - wide[1]}", abs(wide[3] - wide[1] - 506) <= 1)
    assertTrue("centred", abs((wide[1] - rect[1]) - (rect[3] - wide[3])) <= 1)
    val (turnTall, tall) = SheetLayout.fit(1009, 1600, rect)
    assertEquals(true, turnTall)
    assertTrue("width ${tall[2] - tall[0]} height ${tall[3] - tall[1]}", abs(tall[2] - tall[0] - 1011) <= 1 && abs(tall[3] - tall[1] - 637) <= 1)
  }

  @Test fun oneCardSitsWhereTheFrontWould() {
    val one = SheetLayout.cardRects(false)
    assertEquals(1, one.size)
    assertCardSize(one[0])
    assertArrayEquals(SheetLayout.cardRects(true)[0], one[0])
  }
}
