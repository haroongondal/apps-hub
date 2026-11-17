package expo.modules.pdfscan.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class PageGeometryTest {
  private fun px(q: DoubleArray, w: Double, h: Double) = DoubleArray(8) { if (it % 2 == 0) q[it] * w else q[it] * h }
  private val upright = doubleArrayOf(0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0)

  @Test fun scalesTheLongSideDown() {
    assertEquals(2339 to 1559, PageGeometry.outputSize(px(upright, 3000.0, 2000.0), 0, 2339))
  }

  @Test fun rotationSwapsWidthAndHeight() {
    assertEquals(1559 to 2339, PageGeometry.outputSize(px(upright, 3000.0, 2000.0), 90, 2339))
    assertEquals(2339 to 1559, PageGeometry.outputSize(px(upright, 3000.0, 2000.0), 180, 2339))
    assertEquals(1559 to 2339, PageGeometry.outputSize(px(upright, 3000.0, 2000.0), 270, 2339))
  }

  @Test fun neverUpscales() {
    assertEquals(1000 to 700, PageGeometry.outputSize(px(upright, 1000.0, 700.0), 0, 2339))
  }

  @Test fun upscalesOnlyAsFarAsAllowed() {
    assertEquals(1500 to 1050, PageGeometry.outputSize(px(upright, 1000.0, 700.0), 0, 3508, maxScale = 1.5))
    assertEquals(3508 to 2456, PageGeometry.outputSize(px(upright, 3000.0, 2100.0), 0, 3508, maxScale = 1.5))
  }

  @Test fun trapezoidUsesTheLongerOfOppositeEdges() {
    // top 600, bottom 1000; left and right both 500 tall but slanted
    val q = doubleArrayOf(200.0, 0.0, 800.0, 0.0, 1000.0, 400.0, 0.0, 400.0)
    val left = Math.hypot(200.0, 400.0)
    assertEquals(1000 to Math.round(left).toInt(), PageGeometry.outputSize(q, 0, 2339))
  }

  @Test fun rotatedQuadShiftsCornersClockwise() {
    val q = doubleArrayOf(0.1, 0.2, 0.8, 0.25, 0.75, 0.9, 0.15, 0.85)
    assertArrayEquals(q, PageGeometry.rotatedQuad(q, 0), 0.0)
    assertArrayEquals(doubleArrayOf(0.15, 0.85, 0.1, 0.2, 0.8, 0.25, 0.75, 0.9), PageGeometry.rotatedQuad(q, 90), 0.0)
    assertArrayEquals(doubleArrayOf(0.75, 0.9, 0.15, 0.85, 0.1, 0.2, 0.8, 0.25), PageGeometry.rotatedQuad(q, 180), 0.0)
  }

  @Test fun rotatedQuadAgreesWithQuadsRotate() {
    val q = doubleArrayOf(0.1, 0.2, 0.8, 0.25, 0.75, 0.9, 0.15, 0.85)
    for (r in listOf(90, 180, 270)) {
      // The source corner that becomes the output's corner k lands on corner k of the rotated frame.
      val viaFrame = Quads.rotate(q, r)
      val shifted = Quads.rotate(PageGeometry.rotatedQuad(q, r), 0)
      val mapped = DoubleArray(8)
      for (k in 0 until 4) {
        val x = shifted[k * 2]; val y = shifted[k * 2 + 1]
        when (r) {
          90 -> { mapped[k * 2] = 1 - y; mapped[k * 2 + 1] = x }
          180 -> { mapped[k * 2] = 1 - x; mapped[k * 2 + 1] = 1 - y }
          else -> { mapped[k * 2] = y; mapped[k * 2 + 1] = 1 - x }
        }
      }
      assertArrayEquals("rotation $r", viaFrame, mapped, 1e-12)
    }
  }
}
