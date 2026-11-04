package expo.modules.designmedia.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class QuantizerTest {
  private fun distance(a: Int, b: Int): Int {
    val dr = ((a shr 16) and 0xFF) - ((b shr 16) and 0xFF)
    val dg = ((a shr 8) and 0xFF) - ((b shr 8) and 0xFF)
    val db = (a and 0xFF) - (b and 0xFF)
    return dr * dr + dg * dg + db * db
  }

  @Test
  fun anEmptyHistogramHasNoPalette() {
    assertEquals(0, Histogram().palette(256).size)
  }

  @Test
  fun fewerColoursThanTheLimitComeBackAsTheyAre() {
    val h = Histogram()
    h.add(intArrayOf(0xFF0000, 0x00FF00, 0x0000FF, 0xFF0000))
    assertEquals(setOf(0xF80000, 0x00F800, 0x0000F8).size, h.palette(256).size)
    assertEquals(3, h.palette(256).size)
  }

  @Test
  fun aGradientIsReducedToTheLimitAndStaysClose() {
    val h = Histogram()
    val pixels = IntArray(256 * 16) { val v = it % 256; (v shl 16) or (v shl 8) or v }
    h.add(pixels)
    val palette = h.palette(16)
    assertTrue("at most 16, got ${palette.size}", palette.size in 2..16)
    val worst = pixels.maxOf { px -> palette.minOf { distance(px, it) } }
    assertTrue("worst squared error $worst", worst < 3 * 20 * 20)
  }

  @Test
  fun eachPixelBatchAddsToTheSameHistogram() {
    val together = Histogram().apply { add(intArrayOf(0x102030, 0x405060, 0x708090, 0xA0B0C0)) }
    val apart = Histogram().apply {
      add(intArrayOf(0x102030, 0x405060))
      add(intArrayOf(0x708090, 0xA0B0C0))
    }
    assertEquals(together.palette(2).toList(), apart.palette(2).toList())
  }

  @Test
  fun theLimitIsHonouredOnARichImage() {
    val rng = java.util.Random(3)
    val h = Histogram()
    h.add(IntArray(20_000) { rng.nextInt(0x1000000) })
    val palette = h.palette(256)
    assertTrue("palette size ${palette.size}", palette.size in 200..256)
    assertEquals(palette.size, palette.distinct().size)
  }

  @Test
  fun theMergeKeepsTheMostCommonColourNearItsOwn() {
    val h = Histogram()
    h.add(IntArray(900) { 0x2040C0 })
    h.add(IntArray(100) { 0xC04020 })
    h.add(IntArray(50) { 0x80FF80 })
    val palette = h.palette(2)
    assertEquals(2, palette.size)
    assertTrue(palette.any { distance(it, 0x2040C0) < 300 })
  }
}
