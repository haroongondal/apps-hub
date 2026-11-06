package expo.modules.designmedia.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DitherTest {
  private fun indices(palette: IntArray, color: Int, width: Int, height: Int): ByteArray {
    val out = ByteArray(width * height)
    Dither(palette).apply(IntArray(width * height) { color }, width, height, out)
    return out
  }

  @Test
  fun theBayerMatrixIsTheFourByFourOneAndItsOffsetsAreBalanced() {
    assertEquals((0..15).toList(), Dither.BAYER.sorted())
    assertEquals(listOf(0, 8, 2, 10), Dither.BAYER.take(4))
    assertEquals(0, Dither.OFFSETS.sum())
    assertTrue(Dither.OFFSETS.all { it in -8..8 })
    assertTrue(Dither.OFFSETS.toSet().size >= 15)
  }

  @Test
  fun aColourInThePaletteStaysItself() {
    val palette = intArrayOf(0x101010, 0xF0F0F0)
    assertTrue(indices(palette, 0x101010, 8, 8).all { it.toInt() == 0 })
    assertTrue(indices(palette, 0xF0F0F0, 8, 8).all { it.toInt() == 1 })
  }

  @Test
  fun aFlatGreyBetweenBlackAndWhiteBecomesAMixOfBothThatRepeatsEveryFourPixels() {
    val out = indices(intArrayOf(0x000000, 0xFFFFFF), 0x808080, 8, 8)
    val white = out.count { it.toInt() == 1 }
    assertTrue("white count $white of 64", white in 24..40)
    for (y in 0 until 8) for (x in 0 until 4) assertEquals(out[y * 8 + x], out[y * 8 + x + 4])
    for (y in 0 until 4) for (x in 0 until 8) assertEquals(out[y * 8 + x], out[(y + 4) * 8 + x])
  }

  @Test
  fun aDarkerGreyGivesFewerWhitePixelsThanALighterOne() {
    val palette = intArrayOf(0x000000, 0xFFFFFF)
    fun whites(grey: Int) = indices(palette, grey * 0x010101, 8, 8).count { it.toInt() == 1 }
    assertTrue(whites(0x70) <= whites(0x80))
    assertTrue(whites(0x80) <= whites(0x90))
  }

  @Test
  fun everyIndexIsInsideThePalette() {
    val palette = intArrayOf(0xFF0000, 0x00FF00, 0x0000FF)
    val rng = java.util.Random(5)
    val out = ByteArray(32 * 32)
    Dither(palette).apply(IntArray(32 * 32) { rng.nextInt(0x1000000) }, 32, 32, out)
    assertTrue(out.all { it in 0..2 })
  }
}
