package expo.modules.haloengine.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

class QuantizeTest {
  private val red = 0xFFC83020.toInt()
  private val blue = 0xFF2040C8.toInt()

  private fun near(a: Int, b: Int, tol: Int = 2) = listOf(16, 8, 0).all { abs(((a ushr it) and 255) - ((b ushr it) and 255)) <= tol }

  private fun hsv(c: Int): FloatArray {
    val r = ((c shr 16) and 255) / 255f
    val g = ((c shr 8) and 255) / 255f
    val b = (c and 255) / 255f
    val mx = max(r, max(g, b))
    val d = mx - min(r, min(g, b))
    val h = when {
      d == 0f -> 0f
      mx == r -> 60f * (((g - b) / d + 6) % 6)
      mx == g -> 60f * ((b - r) / d + 2)
      else -> 60f * ((r - g) / d + 4)
    }
    return floatArrayOf(h, if (mx == 0f) 0f else d / mx, mx)
  }

  @Test
  fun twoColourImage() {
    val px = IntArray(100) { if (it < 70) red else blue }
    val out = Quantize.dominant(px)
    assertEquals(2, out.size)
    assertTrue(near(out[0], red))
    assertTrue(near(out[1], blue))
  }

  @Test
  fun singleColour() {
    val out = Quantize.dominant(IntArray(50) { red })
    assertEquals(1, out.size)
    assertTrue(near(out[0], red))
  }

  @Test
  fun transparentIgnored() {
    val px = IntArray(100) { if (it < 90) 0x00FFFFFF else blue }
    val out = Quantize.dominant(px)
    assertEquals(1, out.size)
    assertTrue(near(out[0], blue))
    assertEquals(0, Quantize.dominant(IntArray(10) { 0x7FFFFFFF }).size)
  }

  @Test
  fun atMostMax() {
    val px = IntArray(256) { 0xFF000000.toInt() or (it shl 16) or ((it * 7 and 255) shl 8) or (it * 13 and 255) }
    assertEquals(4, Quantize.dominant(px).size)
    assertEquals(2, Quantize.dominant(px, 2).size)
    assertEquals(1, Quantize.dominant(px, 1).size)
  }

  @Test
  fun blackArtIsLifted() {
    val black = Quantize.lift(0xFF000000.toInt())
    assertTrue(hsv(black)[2] >= 0.69f)
    val dark = 0xFF601810.toInt()
    val lifted = Quantize.lift(dark)
    val (h0, s0) = hsv(dark)
    val (h1, s1, v1) = hsv(lifted)
    assertTrue(v1 >= 0.69f)
    assertEquals(h0, h1, 3f)
    assertEquals(s0, s1, 0.03f)
    assertEquals(0xFF, lifted ushr 24)
  }

  @Test
  fun emptyFallsBack() {
    assertEquals(0, Quantize.dominant(IntArray(0)).size)
  }
}
