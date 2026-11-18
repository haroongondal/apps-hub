package expo.modules.designmedia.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpscaleMathsTest {
  @Test
  fun tilesMatchFixture() {
    val cases = Json.parseToJsonElement(qeFile("esrgan_tiles.json").readText()).jsonObject.getValue("cases").jsonArray
    assertEquals(2, cases.size)
    for (c in cases.map { it.jsonObject }) {
      val want = c.getValue("tiles").jsonArray.map { r -> r.jsonArray.map { it.jsonPrimitive.int } }
      val got = tiles(c.getValue("w").jsonPrimitive.int, c.getValue("h").jsonPrimitive.int).map { listOf(it.x, it.y, it.x0, it.y0, it.x1, it.y1) }
      assertEquals(want, got)
    }
  }

  @Test
  fun reflectMatchesNumpy() {
    // np.pad(np.arange(7), 43, mode="reflect")[3:93], i.e. i = -40..49
    val want = listOf(
      4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 0, 1,
      2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 5,
      4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 0, 1,
    )
    assertEquals(want, (-40..49).map { reflect(it, 7) })
    for (i in -50..50) assertEquals(0, reflect(i, 1))
  }

  private fun fakeModel(input: FloatArray): FloatArray {
    val n = SCALE * TILE_IN
    val out = FloatArray(3 * n * n)
    for (c in 0 until 3) for (y in 0 until n) for (x in 0 until n) {
      out[c * n * n + y * n + x] = input[c * TILE_IN * TILE_IN + (y / SCALE) * TILE_IN + x / SCALE]
    }
    return out
  }

  @Test
  fun stitchWithFakeModelIsNearest4x() {
    for ((w, h) in listOf(300 to 200, 129 to 20, 1 to 1)) {
      val argb = IntArray(w * h) { (it * 2654435761L).toInt() or (0xFF shl 24) }
      val ow = SCALE * w
      val out = IntArray(ow * SCALE * h)
      for (t in tiles(w, h)) placeTile(out, ow, fakeModel(tileInput(argb, w, h, t)), t)
      val want = IntArray(out.size) { argb[(it / ow / SCALE) * w + (it % ow) / SCALE] }
      assertArrayEquals("${w}x$h", want, out)
    }
  }

  private fun q8(v: Float) = kotlin.math.floor(v.coerceIn(0f, 1f) * 255f + 0.5f).toInt()

  private val gain = floatArrayOf(0.5f, 1f, -1f)
  private val bias = floatArrayOf(0f, 0f, 1f)

  // Channel c of output pixel (X, Y) = gain[c] * in[c] + bias[c] at window pixel (Y / 4 + 1, X / 4 + 1).
  private fun skewedModel(input: FloatArray): FloatArray {
    val n = SCALE * TILE_IN
    val out = FloatArray(3 * n * n)
    for (c in 0 until 3) for (y in 0 until n) for (x in 0 until n) {
      val sy = minOf(y / SCALE + 1, TILE_IN - 1)
      val sx = minOf(x / SCALE + 1, TILE_IN - 1)
      out[c * n * n + y * n + x] = gain[c] * input[c * TILE_IN * TILE_IN + sy * TILE_IN + sx] + bias[c]
    }
    return out
  }

  @Test
  fun stitchKeepsChannelOrderAndReflects() {
    for ((w, h) in listOf(300 to 200, 129 to 20, 1 to 1)) {
      val argb = IntArray(w * h) { (it * 2654435761L).toInt() or (0xFF shl 24) }
      val ow = SCALE * w
      val out = IntArray(ow * SCALE * h)
      for (t in tiles(w, h)) placeTile(out, ow, skewedModel(tileInput(argb, w, h, t)), t)
      val want = IntArray(out.size) {
        val p = argb[reflect(it / ow / SCALE + 1, h) * w + reflect((it % ow) / SCALE + 1, w)]
        val ch = IntArray(3) { c -> q8(gain[c] * ((p shr (16 - 8 * c) and 0xFF).toFloat() / 255f) + bias[c]) }
        (0xFF shl 24) or (ch[0] shl 16) or (ch[1] shl 8) or ch[2]
      }
      assertArrayEquals("${w}x$h", want, out)
    }
  }

  @Test
  fun tileInputAlwaysFullShape() {
    assertEquals(3 * TILE_IN * TILE_IN, tileInput(intArrayOf(0xFF336699.toInt()), 1, 1, tiles(1, 1)[0]).size)
    assertEquals(TILE + 2 * OVERLAP, TILE_IN)
  }

  @Test
  fun upscalePlanRule() {
    // Owner rule 2026-11-18: 2x runs 4x on a half-size copy; in <= 1024 longest; out = exactly 4 x in.
    assertEquals(UpscalePlan(540, 540, 2160, 2160), upscalePlan(1080, 1080, 2))
    assertEquals(UpscalePlan(1024, 1024, 4096, 4096), upscalePlan(1080, 1080, 4))
    assertEquals(UpscalePlan(150, 100, 600, 400), upscalePlan(300, 200, 2))
    assertEquals(UpscalePlan(300, 200, 1200, 800), upscalePlan(300, 200, 4))
    assertEquals(UpscalePlan(1000, 500, 4000, 2000), upscalePlan(2000, 1000, 2))
    assertEquals(UpscalePlan(1024, 512, 4096, 2048), upscalePlan(2000, 1000, 4))
    assertEquals(UpscalePlan(1, 1, 4, 4), upscalePlan(1, 1, 2))
    assertNull(upscalePlan(4096, 10, 2))
    assertNull(upscalePlan(10, 5000, 4))
    for (w in listOf(1, 7, 300, 1023, 1024, 1025, 2047, 2048, 3000, 4095)) for (h in listOf(1, 13, 999, 2500, 4095)) {
      for (s in listOf(2, 4)) {
        val p = upscalePlan(w, h, s)!!
        assertTrue("$w x $h x $s -> $p", p.inW in 1..1024 && p.inH in 1..1024)
        assertTrue("$w x $h x $s -> $p", p.outW == SCALE * p.inW && p.outH == SCALE * p.inH && maxOf(p.outW, p.outH) <= MAX_SIDE)
      }
    }
  }

  @Test
  fun bleedTransparentFillsFromTheNearestVisiblePixel() {
    // 4x2: visible red at (0, 0) and blue at (3, 1); no fill wraps from a row's end to the next row's start.
    val px = intArrayOf(0x80FF0000.toInt(), 0x00FFFFFF, 0x00FFFFFF, 0x00FFFFFF, 0x00FFFFFF, 0x00FFFFFF, 0x00FFFFFF, 0xFF0000FF.toInt())
    bleedTransparent(px, 4, 2)
    assertArrayEquals(intArrayOf(0x80FF0000.toInt(), 0xFF0000, 0xFF0000, 0x0000FF, 0xFF0000, 0xFF0000, 0x0000FF, 0xFF0000FF.toInt()), px)
    val clear = IntArray(6) { 0x00123456 }
    bleedTransparent(clear, 3, 2)
    assertTrue(clear.all { it == 0x00123456 })
  }

  @Test
  fun upscaleTilesCountsTheModelRuns() {
    assertEquals(25, upscaleTiles(540, 540))
    assertEquals(64, upscaleTiles(1024, 1024))
    assertEquals(1, upscaleTiles(1, 1))
    assertEquals(2, upscaleTiles(129, 20))
    for ((w, h) in listOf(540 to 540, 300 to 200, 1024 to 512, 129 to 20)) assertEquals(tiles(w, h).size, upscaleTiles(w, h))
  }

}
