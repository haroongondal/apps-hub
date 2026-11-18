package expo.modules.pdfscan.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PageProcessorLogicTest {
  @Test fun fullFrameIsTheWholeImage() {
    assertArrayEquals(doubleArrayOf(0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0), PageGeometry.fullFrameQuad(), 0.0)
    assertTrue(PageGeometry.validateQuad(PageGeometry.fullFrameQuad()))
  }

  @Test fun acceptsAConvexQuad() {
    assertTrue(PageGeometry.validateQuad(doubleArrayOf(0.1, 0.2, 0.8, 0.25, 0.75, 0.9, 0.15, 0.85)))
  }

  @Test fun rejectsABowTie() {
    assertFalse(PageGeometry.validateQuad(doubleArrayOf(0.1, 0.1, 0.9, 0.1, 0.1, 0.9, 0.9, 0.9)))
  }

  @Test fun rejectsTheWrongLength() {
    assertFalse(PageGeometry.validateQuad(doubleArrayOf(0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1)))
    assertFalse(PageGeometry.validateQuad(DoubleArray(0)))
  }

  @Test fun rejectsValuesOutsideZeroToOne() {
    assertFalse(PageGeometry.validateQuad(doubleArrayOf(-0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9)))
    assertFalse(PageGeometry.validateQuad(doubleArrayOf(0.1, 0.1, 1.1, 0.1, 0.9, 0.9, 0.1, 0.9)))
    assertFalse(PageGeometry.validateQuad(doubleArrayOf(0.1, 0.1, Double.NaN, 0.1, 0.9, 0.9, 0.1, 0.9)))
  }

  @Test fun rejectsADegenerateQuad() {
    assertFalse(PageGeometry.validateQuad(doubleArrayOf(0.1, 0.1, 0.5, 0.5, 0.9, 0.9, 0.3, 0.3)))
  }
}
