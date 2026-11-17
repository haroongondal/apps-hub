package expo.modules.designmedia.vision

import expo.modules.designmedia.core.SCALE
import expo.modules.designmedia.core.TILE_IN
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class VisionJobTest {
  @get:Rule val folder = TemporaryFolder()

  // Each input pixel becomes a 4x4 block, as in UpscaleMathsTest.
  private fun nearest(input: FloatArray): FloatArray {
    val n = SCALE * TILE_IN
    return FloatArray(3 * n * n) { i ->
      val c = i / (n * n)
      val y = i % (n * n) / n
      val x = i % n
      input[c * TILE_IN * TILE_IN + (y / SCALE) * TILE_IN + x / SCALE]
    }
  }

  @Test
  fun cancelLeavesNoFile() {
    val out = File(folder.root, "vision/job.png")
    var cancelled = false
    var calls = 0
    val model = { input: FloatArray -> calls++; if (calls == 2) cancelled = true; nearest(input) }
    val src = Image(IntArray(300 * 200) { -0x1000000 or it }, 300, 200)
    val e = assertThrows(VisionCancelled::class.java) {
      VisionJob.publish(out, { cancelled }) { part ->
        part.writeText("half")
        VisionJob.upscale(src, 4, model, { cancelled }) {}
      }
    }
    assertEquals("CANCELLED", e.code)
    assertEquals(2, calls)
    assertEquals(emptyList<String>(), File(folder.root, "vision").list()!!.toList())
  }

  @Test
  fun cancelAfterEncodingStillLeavesNoFile() {
    val out = File(folder.root, "vision/job.png")
    assertThrows(VisionCancelled::class.java) { VisionJob.publish(out, { true }) { it.writeText("png") } }
    assertEquals(emptyList<String>(), File(folder.root, "vision").list()!!.toList())
    assertEquals(out, VisionJob.publish(out, { false }) { it.writeText("png") })
    assertEquals(listOf("job.png"), File(folder.root, "vision").list()!!.toList())
  }

  @Test
  fun upscaleReportsProgressAndKeepsTransparentBorder() {
    val w = 20
    val src = Image(IntArray(w * w) { i -> if (i / w in 4..15 && i % w in 4..15) -0xcc9967 else 0x00336699 }, w, w)
    val seen = mutableListOf<Double>()
    val out = VisionJob.upscale(src, 2, ::nearest, { false }) { seen += it }
    assertEquals(listOf(1.0), seen)
    assertEquals(40, out.w)
    assertEquals(40, out.h)
    assertEquals(0, out.argb[0] ushr 24)
    assertEquals(255, out.argb[20 * 40 + 20] ushr 24)
    val opaque = VisionJob.upscale(Image(IntArray(w * w) { -0xcc9967 }, w, w), 4, ::nearest, { false }) {}
    assertTrue(opaque.argb.all { it ushr 24 == 255 })
    assertFalse(opaque.argb.isEmpty())
  }

  @Test
  fun upscaleRefusesTooBig() {
    assertThrows(VisionTooBig::class.java) { VisionJob.upscale(Image(IntArray(4096), 4096, 1), 2, ::nearest, { false }) {} }
  }
}
