package expo.modules.pdfscan.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.sqrt

class FiltersTest {
  private val w = 400
  private val h = 300

  private fun inBar(x: Int, y: Int): Boolean {
    if (y < 30 || (y - 30) % 24 >= 6 || (y - 30) / 24 >= 10) return false
    return x in 40 until 360 && (x - 40) % 40 < 30
  }

  /** White paper with words of dark ink, lit from the left: brightness falls from 255 to 120. */
  private fun page(): IntArray = IntArray(w * h) { i ->
    val x = i % w
    val y = i / w
    val shade = (255.0 - 135.0 * x / (w - 1)) / 255
    val v = ((if (inBar(x, y)) 20.0 else 255.0) * shade).toInt()
    argb(v, v, v)
  }

  private fun argb(r: Int, g: Int, b: Int) = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
  private fun r(c: Int) = (c shr 16) and 0xFF
  private fun g(c: Int) = (c shr 8) and 0xFF
  private fun b(c: Int) = c and 0xFF

  private fun stats(px: IntArray, bar: Boolean): Pair<Double, Double> {
    var n = 0; var sum = 0.0; var sq = 0.0
    for (y in 0 until h) for (x in 0 until w) {
      if (inBar(x, y) != bar) continue
      val v = r(px[y * w + x]).toDouble()
      n++; sum += v; sq += v * v
    }
    val mean = sum / n
    return mean to sqrt(sq / n - mean * mean)
  }

  private fun assertChannelsInRange(px: IntArray) {
    for (c in px) {
      assertEquals(0xFF, c ushr 24)
      for (v in intArrayOf(r(c), g(c), b(c))) assertTrue("channel $v", v in 0..255)
    }
  }

  @Test fun magicFlattensTheShadow() {
    val px = page()
    Filters.magic(px, w, h)
    assertChannelsInRange(px)
    val (bgMean, bgStd) = stats(px, bar = false)
    assertTrue("background std $bgStd", bgStd <= 6)
    for (y in 0 until h) for (x in 0 until w) {
      if (inBar(x, y)) assertTrue("bar at $x,$y is ${r(px[y * w + x])} vs $bgMean", bgMean - r(px[y * w + x]) >= 60)
    }
  }

  @Test fun magicKeepsAndLiftsColour() {
    val px = page()
    for (y in 100 until 110) for (x in 100 until 140) px[y * w + x] = argb(200, 40, 40)
    Filters.magic(px, w, h)
    val c = px[105 * w + 120]
    assertTrue("red ink stayed red: ${r(c)},${g(c)},${b(c)}", r(c) - g(c) >= 100 && r(c) - b(c) >= 100)
  }

  @Test fun magicKeepsMidGreyGrey() {
    val px = page()
    for (y in 100 until 110) for (x in 100 until 140) px[y * w + x] = argb(128, 128, 128)
    Filters.magic(px, w, h)
    val c = px[105 * w + 120]
    assertTrue("grey stayed grey: ${r(c)},${g(c)},${b(c)}", r(c) == g(c) && g(c) == b(c))
    for (v in 0..255) {
      val s = Filters.saturate(v, v, v)
      assertTrue("grey $v became ${r(s)},${g(s)},${b(s)}", r(s) == v && g(s) == v && b(s) == v)
    }
  }

  @Test fun saturationLiftIsGentleOnVividColours() {
    for ((cr, cg, cb) in listOf(Triple(250, 220, 20), Triple(255, 140, 30), Triple(20, 200, 255), Triple(255, 255, 0))) {
      val s = Filters.saturate(cr, cg, cb)
      val before = maxOf(cr, cg, cb) - minOf(cr, cg, cb)
      val after = maxOf(r(s), g(s), b(s)) - minOf(r(s), g(s), b(s))
      assertTrue("spread $before -> $after for $cr,$cg,$cb", after <= before * 1.1)
      for (v in intArrayOf(r(s), g(s), b(s))) assertTrue("channel $v", v in 0..255)
    }
  }

  @Test fun grayIsGrayAndSharperThanPlainLuma() {
    val src = page()
    val px = src.copyOf()
    Filters.gray(px, w, h)
    assertChannelsInRange(px)
    for (c in px) assertTrue(r(c) == g(c) && g(c) == b(c))
    var before = 0.0; var after = 0.0; var n = 0
    for (y in 1 until h) for (x in 0 until w) {
      if (!inBar(x, y) || inBar(x, y - 1)) continue
      before += r(src[(y - 1) * w + x]) - r(src[y * w + x])
      after += r(px[(y - 1) * w + x]) - r(px[y * w + x])
      n++
    }
    assertTrue("edge contrast $after vs $before over $n edges", n > 0 && after >= before)
  }

  @Test fun sauvolaGivesBlackTextOnWhite() {
    val px = page()
    val bits = Filters.sauvola(px, w, h)
    assertEquals(w * h, bits.size)
    var barBlack = 0; var bars = 0; var bgWhite = 0; var bgs = 0
    for (y in 0 until h) for (x in 0 until w) {
      val i = y * w + x
      val v = bits[i].toInt() and 0xFF
      assertTrue(v == 0 || v == 255)
      assertEquals(argb(v, v, v), px[i])
      if (inBar(x, y)) { bars++; if (v == 0) barBlack++ } else { bgs++; if (v == 255) bgWhite++ }
    }
    assertTrue("bars black ${barBlack * 100.0 / bars}%", barBlack >= bars * 0.95)
    assertTrue("background white ${bgWhite * 100.0 / bgs}%", bgWhite >= bgs * 0.99)
  }

  @Test fun blackAndWhitePagesSurviveEveryFilter() {
    for (v in intArrayOf(0, 255)) {
      val a = IntArray(w * h) { argb(v, v, v) }
      Filters.magic(a, w, h)
      assertChannelsInRange(a)
      val b = IntArray(w * h) { argb(v, v, v) }
      Filters.gray(b, w, h)
      assertChannelsInRange(b)
      val c = IntArray(w * h) { argb(v, v, v) }
      Filters.sauvola(c, w, h)
      assertChannelsInRange(c)
    }
  }

  @Test fun tinyImagesDoNotCrash() {
    for ((tw, th) in listOf(1 to 1, 3 to 2, 9 to 17)) {
      val px = IntArray(tw * th) { argb(it * 7 % 256, 128, 30) }
      Filters.magic(px, tw, th)
      Filters.gray(px, tw, th)
      Filters.sauvola(px, tw, th)
      assertChannelsInRange(px)
    }
  }
}
