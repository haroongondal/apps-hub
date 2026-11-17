package expo.modules.designmedia.vision

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Source scan: the vision thread is one process-wide queue, never one per module instance.
class VisionWiringTest {
  private val src = File(requireNotNull(System.getProperty("module.src")), "expo/modules/designmedia")

  @Test
  fun oneVisionQueueForTheProcess() {
    val module = File(src, "DesignMediaModule.kt").readText()
    assertFalse(module.contains("Executors"))
    assertTrue(module.contains("}.runOnQueue(Vision.queue)"))
    assertTrue(File(src, "vision/Vision.kt").readText().contains("object Vision {"))
  }

  // ImageDecoder throws "Cannot scale unpremultiplied pixels!" for a scaled non-opaque source (any RGBA PNG), so
  // unpremultiplied is asked for only when no target size is set. ImageDecoder can't run on the JVM; this scans the source.
  @Test
  fun unpremultipliedOnlyWithoutATargetSize() {
    val vision = File(src, "vision/Vision.kt").readText()
    assertTrue(vision.contains("?.let { (w, h) -> decoder.setTargetSize(w, h) } ?: run { decoder.isUnpremultipliedRequired = true }"))
    assertEquals(1, Regex("isUnpremultipliedRequired").findAll(vision).count())
  }
}
