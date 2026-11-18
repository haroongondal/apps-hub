package expo.modules.designmedia.vision

import ai.onnxruntime.OrtException
import expo.modules.designmedia.core.Filter
import expo.modules.designmedia.core.SCALE
import expo.modules.designmedia.core.TILE_IN
import expo.modules.designmedia.core.VisionModels
import expo.modules.designmedia.core.resize
import expo.modules.designmedia.core.upscalePlan
import java.io.File
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
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

  // A smoothing model (LANCZOS 4x of the tile), like the real one: a hard edge comes out as a ramp.
  private fun smooth(input: FloatArray): FloatArray {
    val plane = TILE_IN * TILE_IN
    val argb = IntArray(plane) { i ->
      val c = { k: Int -> Math.round(input[k * plane + i] * 255f) }
      (0xFF shl 24) or (c(0) shl 16) or (c(1) shl 8) or c(2)
    }
    val n = SCALE * TILE_IN
    val big = resize(argb, TILE_IN, TILE_IN, n, n, Filter.LANCZOS)
    return FloatArray(3 * n * n) { i -> (big[i % (n * n)] shr (16 - 8 * (i / (n * n))) and 0xFF) / 255f }
  }

  @Test
  fun upscaleOfAlphaHasNoDarkFringe() {
    val w = 40
    val src = Image(IntArray(w * w) { i -> if (i / w in 10..29 && i % w in 10..29) 0xFFFF0000.toInt() else 0 }, w, w)
    val out = VisionJob.upscale(src, upscalePlan(w, w, 4)!!, ::smooth, { false }) {}
    var soft = 0
    for (p in out.argb) {
      val a = p ushr 24
      if (a == 0) assertEquals(0, p)
      if (a >= 32) {
        assertTrue("%08x".format(p), (p shr 16 and 0xFF) >= 250 && (p shr 8 and 0xFF) <= 5 && (p and 0xFF) <= 5)
      }
      if (a in 32..250) soft++
    }
    assertTrue("the edge is soft", soft > 0)
  }

  @Test
  fun aFailedWriteSaysSoAndLeavesNoFile() {
    val out = File(folder.root, "vision/job.png")
    val e = assertThrows(Exception::class.java) { VisionJob.publish(out, { false }) { it.writeText("half"); throw IOException("ENOSPC") } }
    assertEquals("The result couldn't be saved. Free up some space and try again.", e.message)
    assertEquals(emptyList<String>(), File(folder.root, "vision").list()!!.toList())
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
        VisionJob.upscale(src, upscalePlan(300, 200, 4)!!, model, { cancelled }) {}
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
    // 2x of a 40x40 photo: the decoder hands over the 20x20 half-size copy, and the output is exactly 4x that.
    val w = 20
    val plan = upscalePlan(2 * w, 2 * w, 2)!!
    val src = Image(IntArray(w * w) { i -> if (i / w in 4..15 && i % w in 4..15) -0xcc9967 else 0x00336699 }, w, w)
    val out = VisionJob.upscale(src, plan, ::nearest, { false }) {}
    assertEquals(80 to 80, out.w to out.h)
    assertEquals(plan.outW to plan.outH, out.w to out.h)
    assertEquals(0, out.argb[0] ushr 24)
    assertEquals(255, out.argb[40 * 80 + 40] ushr 24)
    val seen = mutableListOf<Double>()
    val opaque = VisionJob.upscale(Image(IntArray(300 * 200) { -0xcc9967 }, 300, 200), upscalePlan(300, 200, 4)!!, ::nearest, { false }) { seen += it }
    assertEquals((1..6).map { it / 6.0 }, seen)
    assertEquals(1200 to 800, opaque.w to opaque.h)
    assertTrue(opaque.argb.all { it ushr 24 == 255 })
  }

  @Test
  fun upscaleInputMustBeThePlansSize() {
    assertThrows(IllegalArgumentException::class.java) {
      VisionJob.upscale(Image(IntArray(2000 * 10), 2000, 10), upscalePlan(2000, 10, 2)!!, ::nearest, { false }) {}
    }
    val half = VisionJob.upscale(Image(IntArray(1000 * 5) { -0x1000000 }, 1000, 5), upscalePlan(2000, 10, 2)!!, ::nearest, { false }) {}
    assertEquals(4000 to 20, half.w to half.h)
  }

  @Test
  fun cutoutKeepsExistingTransparency() {
    val px = intArrayOf(0x00FF0000, 0xFF00FF00.toInt(), 0x3200FF00, 0xFF0000FF.toInt())
    val img = VisionJob.cutout(Image(px, 2, 2), floatArrayOf(0.5f), 1, 1, false, 0f)
    assertEquals(listOf(0, 128, 50, 128), img.argb.map { it ushr 24 })
    assertEquals(listOf(0xFF0000, 0x00FF00, 0x00FF00, 0x0000FF), img.argb.map { it and 0xFFFFFF })
    assertSame("written in place", px, img.argb)
  }

  @Test
  fun toolForMapsOpAndOption() {
    assertEquals(VisionModels.MODNET, VisionJob.toolFor("cutout", "person"))
    assertEquals(VisionModels.U2NETP, VisionJob.toolFor("cutout", "object"))
    assertEquals(VisionModels.ESRGAN, VisionJob.toolFor("upscale", "2"))
    assertEquals(VisionModels.ESRGAN, VisionJob.toolFor("upscale", "4"))
    listOf("cutout" to "upscale", "cutout" to "2", "cutout" to "", "upscale" to "3", "upscale" to "person", "blur" to "2", "" to "object")
      .forEach { (op, option) -> assertNull("$op $option", VisionJob.toolFor(op, option)) }
  }

  @Test
  fun cutoutTargetFitsTheBudget() {
    assertNull(VisionJob.cutoutTarget(4000, 3000))
    assertNull(VisionJob.cutoutTarget(4096, 3072))
    assertEquals(4096 to 3072, VisionJob.cutoutTarget(8192, 6144))
    for ((w, h) in listOf(8000 to 6000, 40000 to 400, 4097 to 3072, 3072 to 4097)) {
      val (tw, th) = VisionJob.cutoutTarget(w, h)!!
      assertTrue("$w x $h -> $tw x $th", tw.toLong() * th <= VisionJob.CUTOUT_MAX_PIXELS && tw >= 1 && th >= 1)
      assertTrue("aspect $w x $h -> $tw x $th", Math.abs(tw.toLong() * h - th.toLong() * w) <= w + h)
    }
  }

  @Test
  fun outOfMemorySaysSoInPlainWords() {
    val e = assertThrows(VisionNoMemory::class.java) { VisionJob.plainWords { throw OutOfMemoryError("Failed to allocate a 64 MB allocation") } }
    assertEquals("This image is too big for this tool.", e.message)
    assertEquals(3, VisionJob.plainWords { 3 })
    val ort = assertThrows(Exception::class.java) { VisionJob.plainWords { throw OrtException("Load model from x failed: Protobuf parsing failed") } }
    assertEquals("This tool didn't work on this image. Try again.", ort.message)
    assertThrows(VisionCancelled::class.java) { VisionJob.plainWords { throw VisionCancelled() } }
  }
}
