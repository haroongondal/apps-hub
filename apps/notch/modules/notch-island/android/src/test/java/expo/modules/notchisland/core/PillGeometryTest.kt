package expo.modules.notchisland.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PillGeometryTest {
  // The Xiaomi 24116RACCG's hole: 1080 px wide screen, hole x 510..570, 110 px deep, density 2.8125.
  private val hole = Cutout(510, 570, 110)
  private val d = 2.8125f

  @Test fun collapsedHugsTheHoleAndStaysCentred() {
    val box = PillGeometry.collapsed(hole, 1080, d)
    assertEquals(0, box.xFromCenter)
    assertEquals(60 + 2 * 22, box.width)
    assertEquals(110 + 11, box.height)
  }

  @Test fun anOffCentreHoleMovesThePill() {
    val box = PillGeometry.collapsed(Cutout(100, 160, 110), 1080, d)
    assertEquals(130 - 540, box.xFromCenter)
  }

  @Test fun noCutoutGivesACentredFallbackPill() {
    val box = PillGeometry.collapsed(null, 1080, d)
    assertEquals(0, box.xFromCenter)
    assertTrue(box.width > 0 && box.height > 0)
  }

  @Test fun expandedIsBiggerAndCentredOnTheSameSpot() {
    val c = PillGeometry.collapsed(hole, 1080, d)
    val e = PillGeometry.expanded(hole, 1080, d)
    assertTrue(e.width > c.width && e.height > c.height)
    assertEquals(c.xFromCenter, e.xFromCenter)
  }

  @Test fun withIndicator_widens_both_sides_and_keeps_centre() {
    assertEquals(PillBox(10, 124, 50), PillGeometry.withIndicator(PillBox(10, 100, 50), 24))
  }

  @Test fun expanded_grows_by_row_height() {
    val base = PillGeometry.expanded(hole, 1080, d)
    val tall = PillGeometry.expanded(hole, 1080, d, rows = 2)
    assertEquals(2 * 112, PillGeometry.expandedRowsPx(2, d))
    assertEquals(base.height + 2 * 112, tall.height)
    assertEquals(base.width, tall.width)
  }

  @Test fun existing_expanded_unchanged_with_zero_rows() {
    assertEquals(PillGeometry.expanded(hole, 1080, d), PillGeometry.expanded(hole, 1080, d, rows = 0))
    assertEquals(0, PillGeometry.expandedRowsPx(0, d))
  }

  @Test fun expandedNeverReachesTheScreenEdge() {
    val e = PillGeometry.expanded(hole, 300, 1f)
    assertEquals(300 - 32, e.width)
  }

  @Test fun lerpEndsMatchTheBoxes() {
    val a = PillGeometry.collapsed(hole, 1080, d)
    val b = PillGeometry.expanded(hole, 1080, d)
    assertEquals(a, PillGeometry.lerp(a, b, 0f))
    assertEquals(b, PillGeometry.lerp(a, b, 1f))
  }

  @Test fun sizePresetsScaleAndUnknownIsRegular() {
    assertEquals(0.85f, PillGeometry.sizeScale("compact"), 0.0001f)
    assertEquals(1.15f, PillGeometry.sizeScale("large"), 0.0001f)
    assertEquals(1.0f, PillGeometry.sizeScale("bogus"), 0.0001f)
  }

  @Test fun foldDelayIsNullForNever() {
    assertNull(PillGeometry.foldDelayMs(0))
    assertEquals(5000L, PillGeometry.foldDelayMs(5000))
  }
}
