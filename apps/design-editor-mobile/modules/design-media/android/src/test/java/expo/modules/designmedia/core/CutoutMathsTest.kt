package expo.modules.designmedia.core

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

internal fun qeFile(name: String) = File(File(System.getProperty("fixtures.dir"), "quick-edits"), name)

internal fun qeF32(name: String): FloatArray {
  val b = ByteBuffer.wrap(qeFile(name).readBytes()).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
  return FloatArray(b.remaining()).also { b.get(it) }
}

// rawBand0: the first band's stored samples (getRGB colour-converts grey PNGs).
internal class Png(val w: Int, val h: Int, val argb: IntArray, val rawBand0: IntArray)

// ImageIO is on the test JVM but not on the android.jar compile classpath, so call it by reflection.
internal fun qePng(name: String): Png {
  val img = Class.forName("javax.imageio.ImageIO").getMethod("read", File::class.java).invoke(null, qeFile(name))
  val w = img.javaClass.getMethod("getWidth").invoke(img) as Int
  val h = img.javaClass.getMethod("getHeight").invoke(img) as Int
  val t = Int::class.javaPrimitiveType
  val argb = IntArray(w * h)
  img.javaClass.getMethod("getRGB", t, t, t, t, IntArray::class.java, t, t).invoke(img, 0, 0, w, h, argb, 0, w)
  val raster = img.javaClass.getMethod("getRaster").invoke(img)
  val band0 = IntArray(w * h)
  Class.forName("java.awt.image.Raster").getMethod("getSamples", t, t, t, t, t, IntArray::class.java).invoke(raster, 0, 0, w, h, 0, band0)
  return Png(w, h, argb, band0)
}

internal fun assertClose(expected: FloatArray, got: FloatArray, tol: Float) {
  assertEquals(expected.size, got.size)
  var max = 0f
  for (i in got.indices) max = maxOf(max, abs(got[i] - expected[i]))
  println("max abs diff $max")
  assertTrue("max abs diff $max", max <= tol)
}

class CutoutMathsTest {
  @Test
  fun u2InputMatchesUpscaleFixture() {
    val p = qePng("u2_input.png")
    assertClose(qeF32("u2_input.f32"), u2Input(p.argb, p.w, p.h), 1e-5f)
  }

  @Test
  fun u2InputMatchesDownscaleFixture() {
    val p = qePng("u2_down_input.png")
    assertEquals(640 to 480, p.w to p.h)
    assertClose(qeF32("u2_down_input.f32"), u2Input(p.argb, p.w, p.h), 1e-5f)
  }

  @Test
  fun modnetSizeRule() {
    assertEquals(704 to 512, modnetSize(700, 500))
    assertEquals(512 to 704, modnetSize(500, 700))
    assertEquals(672 to 512, modnetSize(4000, 3000))
    assertEquals(32 to 1024, modnetSize(10, 4000))
    assertEquals(512 to 512, modnetSize(33, 32))
    for (w in 1..40) for (h in 1..40) {
      val (a, b) = modnetSize(w * 37, h * 53)
      assertTrue("${w * 37}x${h * 53} -> $a x $b", a >= 32 && b >= 32 && a % 32 == 0 && b % 32 == 0 && maxOf(a, b) <= 1024)
    }
  }

  @Test
  fun modnetInputMatchesFixture() {
    val p = qePng("modnet_input.png")
    val got = modnetInput(p.argb, p.w, p.h)
    assertEquals(3 * 512 * 704, got.size)
    assertClose(qeF32("modnet_input.f32"), got, 1e-5f)
  }

  @Test
  fun alphaMaskMatchesU2Fixture() {
    val want = qePng("u2_mask.png")
    val got = alphaMask(qeF32("u2_pred.f32"), 320, 320, 300, 200, true, 2f)
    assertEquals(300 * 200, got.size)
    var max = 0
    for (i in got.indices) max = maxOf(max, abs((got[i].toInt() and 0xFF) - want.rawBand0[i]))
    println("CutoutMathsTest mask max diff $max")
    assertTrue("max mask diff $max", max <= 1)
  }

  @Test
  fun alphaMaskMinMaxNormalisesRawPred() {
    val want = qePng("u2_mask.png")
    val raw = qeF32("u2_pred.f32").map { it * 0.6f + 0.1f }.toFloatArray()
    val got = alphaMask(raw, 320, 320, 300, 200, true, 2f)
    var max = 0
    for (i in got.indices) max = maxOf(max, abs((got[i].toInt() and 0xFF) - want.rawBand0[i]))
    assertTrue("max mask diff $max", max <= 1)
  }

  @Test
  fun alphaMaskHandles12Mp() {
    val pred = FloatArray(320 * 320) { ((it % 320) * (it / 320) % 97) / 96f }
    assertEquals(12_000_000, alphaMask(pred, 320, 320, 4000, 3000, true, 2f).size)
  }

  @Test
  fun alphaMaskWithoutMinMaxClips() {
    val got = alphaMask(floatArrayOf(-0.5f, 0.5f, 1.5f, 1f), 2, 2, 2, 2, false, 0f)
    assertArrayEquals(byteArrayOf(0, 128.toByte(), 255.toByte(), 255.toByte()), got)
  }

  @Test
  fun withAlphaAndHasAlpha() {
    val px = intArrayOf(0xFF102030.toInt(), 0x00405060)
    assertFalse(hasAlpha(intArrayOf(0xFF000000.toInt(), -1)))
    assertTrue(hasAlpha(px))
    val out = withAlpha(px, byteArrayOf(0x7F, 0xFF.toByte()))
    assertArrayEquals(intArrayOf(0x7F102030, 0xFF405060.toInt()), out)
    assertFalse(hasAlpha(withAlpha(px, byteArrayOf(-1, -1))))
  }
}
