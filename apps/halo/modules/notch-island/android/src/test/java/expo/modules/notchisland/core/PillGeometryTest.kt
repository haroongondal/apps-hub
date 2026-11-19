package expo.modules.notchisland.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PillGeometryTest {
  // The Xiaomi 24116RACCG's hole: 1080 px wide screen, hole x 510..570, 110 px deep, density 2.8125.
  private val hole = Cutout(510, 570, 110)
  private val d = 2.8125f

  @Test fun collapsedTakesAThirdOfTheScreenAndStaysCentred() {
    val box = PillGeometry.collapsed(hole, 1080, d)
    assertEquals(0, box.xFromCenter)
    assertEquals(345, box.width) // 0.32 * 1080 beats 60 + 2 * 22
    assertEquals(110 + 11, box.height)
  }

  @Test fun aWideHoleIsHuggedInstead() {
    assertEquals(400 + 16, PillGeometry.collapsed(Cutout(300, 700, 80), 1080, 1f).width)
  }

  @Test fun sizePresetScalesTheClosedWidthButNotPastTheEdges() {
    assertEquals((345 * 1.15f).toInt(), PillGeometry.collapsed(hole, 1080, d, 1.15f).width)
    assertEquals((345 * 0.85f).toInt(), PillGeometry.collapsed(hole, 1080, d, 0.85f).width)
    assertEquals(300 - 32, PillGeometry.collapsed(Cutout(0, 290, 30), 300, 1f, 1.15f).width)
  }

  @Test fun anOffCentreHoleMovesThePill() {
    val box = PillGeometry.collapsed(Cutout(100, 160, 110), 1080, d)
    assertEquals(130 - 540, box.xFromCenter)
  }

  @Test fun noCutoutUsesTheSameThirdRuleAndA28dpHeight() {
    val box = PillGeometry.collapsed(null, 1080, d)
    assertEquals(PillBox(0, 345, 78), box)
  }

  @Test fun expandedSpansTheScreenLess11dpEachSide() {
    val e = PillGeometry.expanded(hole, 1080, d)
    assertEquals(1080 - 2 * 30, e.width)
    assertEquals(0, e.xFromCenter)
    assertEquals(300 - 22, PillGeometry.expanded(hole, 300, 1f).width)
  }

  @Test fun expandedOffCentreHoleStaysOnScreen() {
    assertEquals(-30, PillGeometry.expanded(Cutout(100, 160, 110), 1080, d).xFromCenter)
  }

  @Test fun heightsUseTheIphoneBasesUnderAShallowHole() {
    assertEquals(84, PillGeometry.expandedHeight(28, emptyList(), 1f))
    assertEquals(160, PillGeometry.expandedHeight(0, listOf("media"), 1f))
  }

  @Test fun heightsGrowToFitTheRowsUnderADeepHole() {
    // hole row 121 px on the Xiaomi; 84 dp = 236 px
    assertEquals(236, PillGeometry.expanded(hole, 1080, d).height)
    assertEquals(121 + (76 * d).toInt(), PillGeometry.expanded(hole, 1080, d, listOf("call")).height)
    assertEquals(121 + (120 * d).toInt(), PillGeometry.expanded(hole, 1080, d, listOf("timer")).height)
    assertEquals(121 + (160 * d).toInt(), PillGeometry.expanded(hole, 1080, d, listOf("media")).height)
    assertEquals(121 + ((16 + 128 + 12 + 88 + 16) * d).toInt(), PillGeometry.expanded(hole, 1080, d, listOf("media", "timer")).height)
  }

  @Test fun anEventRowKeepsTheShortBaseOrFitsUnderADeepHole() {
    assertEquals(84, PillGeometry.expandedHeight(0, listOf("event"), 1f))
    assertEquals(121 + ((16 + 48 + 16) * d).toInt(), PillGeometry.expanded(hole, 1080, d, listOf("event")).height)
  }

  @Test fun aProgressRowIs64dpAndAddsARowBelowMedia() {
    assertEquals(64, PillGeometry.rowDp("progress"))
    assertEquals(16 + 64 + 16, PillGeometry.expandedHeight(0, listOf("progress"), 1f))
    assertEquals(121 + ((16 + 64 + 16) * d).toInt(), PillGeometry.expanded(hole, 1080, d, listOf("progress")).height)
    assertEquals(121 + ((16 + 128 + 12 + 64 + 16) * d).toInt(), PillGeometry.expanded(hole, 1080, d, listOf("media", "progress")).height)
  }

  @Test fun extraRowsAdd64dpToTheBase() {
    assertEquals(84 + 64, PillGeometry.expandedHeight(-1000, listOf("call", "timer"), 1f))
    assertEquals(160 + 2 * 64, PillGeometry.expandedHeight(-1000, listOf("call", "media", "timer"), 1f))
  }

  @Test fun withIndicator_widens_both_sides_and_keeps_centre() {
    assertEquals(PillBox(10, 124, 50), PillGeometry.withIndicator(PillBox(10, 100, 50), 24))
  }

  @Test fun lerpEndsMatchTheBoxes() {
    val a = PillGeometry.collapsed(hole, 1080, d)
    val b = PillGeometry.expanded(hole, 1080, d, listOf("media"))
    assertEquals(a, PillGeometry.lerp(a, b, 0f))
    assertEquals(b, PillGeometry.lerp(a, b, 1f))
  }

  @Test fun lerpOvershootsButNeverPastTheScreen() {
    val a = PillBox(0, 100, 50)
    val b = PillBox(0, 200, 100)
    assertEquals(PillBox(0, 210, 105), PillGeometry.lerp(a, b, 1.1f))
    assertEquals(205, PillGeometry.lerp(a, b, 1.1f, maxWidth = 205).width)
    assertEquals(PillBox(0, 90, 45), PillGeometry.lerp(b, a, 1.1f))
  }

  @Test fun pillCornersAreACapsuleCappedAt44dp() {
    assertEquals(25f, PillGeometry.radius("pill", 50, 1f), 0f)
    assertEquals(44f, PillGeometry.radius("pill", 200, 1f), 0f)
    assertEquals(28f, PillGeometry.radius("rounded", 200, 1f), 0f)
    assertEquals(6f, PillGeometry.radius("squared", 200, 1f), 0f)
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
