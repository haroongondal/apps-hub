package expo.modules.designmedia.core

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ClipImageTest {
  private val mean = floatArrayOf(0.48145466f, 0.4578275f, 0.40821073f)
  private val std = floatArrayOf(0.26862954f, 0.26130258f, 0.27577711f)
  private val plane = 224 * 224

  @Test
  fun matchesPilWithinOneLevel() {
    val dir = File(System.getProperty("fixtures.dir"), "photo-search")
    // ImageIO is on the test JVM but not on the android.jar compile classpath, so call it by reflection.
    val img = Class.forName("javax.imageio.ImageIO").getMethod("read", File::class.java).invoke(null, File(dir, "image.png"))
    val w = img.javaClass.getMethod("getWidth").invoke(img) as Int
    val h = img.javaClass.getMethod("getHeight").invoke(img) as Int
    val argb = IntArray(w * h)
    val t = Int::class.javaPrimitiveType
    img.javaClass.getMethod("getRGB", t, t, t, t, IntArray::class.java, t, t).invoke(img, 0, 0, w, h, argb, 0, w)
    val expected = ByteBuffer.wrap(File(dir, "image.f32").readBytes()).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
    val got = clipTensor(argb, w, h)
    assertEquals(3 * plane, got.size)
    assertEquals(3 * plane, expected.remaining())
    var max = 0.0
    var sum = 0.0
    for (i in got.indices) {
      val d = abs(got[i] - expected.get(i)).toDouble()
      val c = i / plane
      assertTrue("element $i off by $d", d <= (1.0 / 255) / std[c] + 1e-5)
      max = maxOf(max, d)
      sum += d
    }
    val meanDiff = sum / got.size
    println("ClipImageTest max abs diff $max, mean abs diff $meanDiff")
    assertTrue("mean abs diff $meanDiff", meanDiff < 0.002)
  }

  @Test
  fun squareInputOnlyResizes() {
    val rgb = intArrayOf(200, 100, 30)
    val px = (0xFF shl 24) or (rgb[0] shl 16) or (rgb[1] shl 8) or rgb[2]
    val got = clipTensor(IntArray(448 * 448) { px }, 448, 448)
    assertEquals(3 * plane, got.size)
    for (i in got.indices) {
      val c = i / plane
      assertEquals("element $i", (rgb[c] / 255f - mean[c]) / std[c], got[i], 1e-5f)
    }
  }
}
