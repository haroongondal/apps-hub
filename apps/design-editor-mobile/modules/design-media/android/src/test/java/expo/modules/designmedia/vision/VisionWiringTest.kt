package expo.modules.designmedia.vision

import java.io.File
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
}
