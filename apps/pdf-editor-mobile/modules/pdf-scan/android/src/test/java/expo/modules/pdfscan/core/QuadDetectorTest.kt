package expo.modules.pdfscan.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin
import kotlin.random.Random

class QuadDetectorTest {
  private val w = 640
  private val h = 480

  private fun inside(q: DoubleArray, x: Double, y: Double): Boolean {
    for (k in 0 until 4) {
      val ax = q[k * 2]; val ay = q[k * 2 + 1]
      val bx = q[((k + 1) % 4) * 2]; val by = q[((k + 1) % 4) * 2 + 1]
      if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < 0) return false
    }
    return true
  }

  /** Wood-like background, a light page with dark "text" blocks, sensor noise. Corners in pixels. */
  private fun frame(corners: DoubleArray?, seed: Int, page: Int = 215, bg: Int = 90): Luma {
    val rnd = Random(seed)
    val img = ByteArray(w * h)
    for (y in 0 until h) for (x in 0 until w) {
      val grain = (12 * sin(x / 23.0 + 3 * sin(y / 57.0))).toInt()
      var v = bg + grain + rnd.nextInt(-8, 9)
      if (corners != null && inside(corners, x + 0.5, y + 0.5)) {
        v = page + rnd.nextInt(-6, 7)
        // text lines: map to page-relative coordinates by bilinear inverse is overkill; use bands in the bbox
        val u = (x - corners[0]) / (corners[2] - corners[0])
        val t = (y - corners[1]) / (corners[7] - corners[1])
        if (u in 0.12..0.88 && t in 0.1..0.9 && ((t * 40).toInt() % 3 == 0) && rnd.nextInt(5) != 0) v = 40 + rnd.nextInt(30)
      }
      img[y * w + x] = v.coerceIn(0, 255).toByte()
    }
    return Luma(img, w, h)
  }

  private fun tilted(cx: Double, cy: Double, pw: Double, ph: Double, deg: Double, keystone: Double = 0.0): DoubleArray {
    val a = Math.toRadians(deg)
    val pts = arrayOf(
      doubleArrayOf(-pw / 2 + keystone, -ph / 2), doubleArrayOf(pw / 2 - keystone, -ph / 2),
      doubleArrayOf(pw / 2, ph / 2), doubleArrayOf(-pw / 2, ph / 2),
    )
    val out = DoubleArray(8)
    for (k in 0 until 4) {
      out[k * 2] = cx + pts[k][0] * cos(a) - pts[k][1] * sin(a)
      out[k * 2 + 1] = cy + pts[k][0] * sin(a) + pts[k][1] * cos(a)
    }
    return out
  }

  private fun assertFound(expectedPx: DoubleArray, det: Detection?) {
    assertNotNull("no page found", det)
    val expected = DoubleArray(8) { if (it % 2 == 0) expectedPx[it] / w else expectedPx[it] / h }
    val share = Quads.maxCornerShareOfDiagonal(Quads.order(expected), det!!.quad, w.toDouble() / h)
    assertTrue("corner off by ${"%.4f".format(share)} of the diagonal", share <= 0.02)
  }

  @Test fun straightPage() {
    val q = tilted(320.0, 240.0, 300.0, 400.0, 0.0)
    assertFound(q, QuadDetector().detect(frame(q, 1)))
  }

  @Test fun rotatedAndTiltedPages() {
    val cases = listOf(
      tilted(330.0, 245.0, 280.0, 380.0, 12.0),
      tilted(310.0, 235.0, 300.0, 390.0, -18.0, keystone = 40.0),
      tilted(320.0, 240.0, 380.0, 280.0, 30.0, keystone = 25.0),
      tilted(300.0, 250.0, 200.0, 420.0, 5.0, keystone = 20.0),
    )
    val detector = QuadDetector()
    cases.forEachIndexed { i, q -> assertFound(q, detector.detect(frame(q, 10 + i))) }
  }

  @Test fun pageOutOfFrameIsRejected() {
    val q = tilted(560.0, 240.0, 320.0, 400.0, 8.0)
    assertNull(QuadDetector().detect(frame(q, 3)))
  }

  @Test fun cornerJustPastTheFrameStaysInsideZeroToOne() {
    val detector = QuadDetector()
    var found = 0
    for (shift in listOf(0.0, 4.0, 8.0, 12.0, 20.0)) for (deg in listOf(6.0, 10.0, -8.0)) {
      val q = tilted(320.0, 240.0 - shift, 320.0, 440.0, deg)
      val det = detector.detect(frame(q, 3)) ?: continue
      found++
      assertTrue("shift $shift deg $deg gave ${det.quad.joinToString()}", det.quad.all { it in 0.0..1.0 })
    }
    assertTrue("no clipped page was accepted, so nothing was checked", found > 0)
  }

  private val cardDetector = QuadDetector(DetectorConfig(targetAspect = 1.586))

  @Test fun cardModeFindsACard() {
    val q = tilted(320.0, 240.0, 380.0, 240.0, 0.0)
    assertFound(q, cardDetector.detect(frame(q, 20)))
  }

  @Test fun cardModeSkipsASquareTheDefaultFinds() {
    val q = tilted(320.0, 240.0, 300.0, 300.0, 0.0)
    assertNull(cardDetector.detect(frame(q, 21)))
    assertFound(q, QuadDetector().detect(frame(q, 21)))
  }

  @Test fun cardModeFindsAPortraitCard() {
    val q = tilted(320.0, 240.0, 240.0, 380.0, 0.0)
    assertFound(q, cardDetector.detect(frame(q, 22)))
  }

  @Test fun rotation270AndAspectSwap() {
    val q = doubleArrayOf(0.1, 0.2, 0.8, 0.25, 0.75, 0.9, 0.15, 0.85)
    val back = Quads.rotate(Quads.rotate(q, 270), 90)
    assertTrue(Quads.maxCornerShareOfDiagonal(back, q, 1.0) < 1e-9)
    val d = Detection(q, 4.0 / 3, 1.0, ByteArray(0))
    assertEquals(0.75, d.rotated(270).aspect, 1e-9)
    assertEquals(4.0 / 3, d.rotated(180).aspect, 1e-9)
  }

  @Test fun blankFrameFindsNothing() {
    val img = ByteArray(w * h) { 128.toByte() }
    assertNull(QuadDetector().detect(Luma(img, w, h)))
    assertNull(QuadDetector().detect(frame(null, 4)))
  }

  @Test fun clutterFindsNothing() {
    val rnd = Random(5)
    val img = frame(null, 6).data
    repeat(60) {
      val x0 = rnd.nextInt(w - 60); val y0 = rnd.nextInt(h - 60)
      val bw = rnd.nextInt(10, 60); val bh = rnd.nextInt(10, 60)
      val v = rnd.nextInt(0, 256)
      for (y in y0 until y0 + bh) for (x in x0 until x0 + bw) img[y * w + x] = v.toByte()
    }
    assertNull(QuadDetector().detect(Luma(img, w, h)))
  }

  @Test fun rowStrideWiderThanWidth() {
    val q = tilted(320.0, 240.0, 300.0, 400.0, 7.0)
    val plain = frame(q, 7)
    val stride = w + 64
    val padded = ByteArray(stride * h)
    for (y in 0 until h) System.arraycopy(plain.data, y * w, padded, y * stride, w)
    assertFound(q, QuadDetector().detect(Luma(padded, w, h, stride)))
  }

  @Test fun sharpPageScoresAboveBlurredPage() {
    val q = tilted(320.0, 240.0, 300.0, 400.0, 0.0)
    val sharp = frame(q, 8)
    val blurred = sharp.data.copyOf()
    repeat(3) { boxBlur(blurred, 3) }
    val a = QuadDetector().detect(sharp)!!.sharpness
    val b = QuadDetector().detect(Luma(blurred, w, h))?.sharpness ?: 0.0
    assertTrue("sharp $a vs blurred $b", a > b * 3)
  }

  @Test fun rotationMapsToUpright() {
    val q = doubleArrayOf(0.1, 0.2, 0.8, 0.25, 0.75, 0.9, 0.15, 0.85)
    val r = Quads.rotate(q, 90)
    // sensor point (x, y) is upright (1 - y, x); TL of the upright frame is sensor BL
    assertEquals(1 - 0.85, r[0], 1e-9)
    assertEquals(0.15, r[1], 1e-9)
    val back = Quads.rotate(Quads.rotate(r, 180), 90)
    assertTrue(Quads.maxCornerShareOfDiagonal(back, q, 1.0) < 1e-9)
  }

  @Test fun orderHandlesAPageTurned45Degrees() {
    val q = doubleArrayOf(0.5, 0.1, 0.9, 0.5, 0.5, 0.9, 0.1, 0.5)
    val o = Quads.order(doubleArrayOf(q[4], q[5], q[0], q[1], q[6], q[7], q[2], q[3]))
    val seen = (0 until 4).map { o[it * 2] to o[it * 2 + 1] }.toSet()
    assertEquals(4, seen.size)
    assertTrue(hypot(o[2] - o[0], o[3] - o[1]) > 0.1)
  }

  private fun boxBlur(img: ByteArray, r: Int) {
    val src = img.copyOf()
    for (y in 0 until h) for (x in 0 until w) {
      var s = 0; var n = 0
      for (dy in -r..r) for (dx in -r..r) {
        val nx = x + dx; val ny = y + dy
        if (nx in 0 until w && ny in 0 until h) { s += src[ny * w + nx].toInt() and 0xFF; n++ }
      }
      img[y * w + x] = (s / n).toByte()
    }
  }
}
