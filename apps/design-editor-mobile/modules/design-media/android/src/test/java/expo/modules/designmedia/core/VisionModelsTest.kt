package expo.modules.designmedia.core

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VisionModelsTest {
  @Test
  fun toolsMapPinsTheThreeModels() {
    assertEquals(listOf("person", "object", "upscale"), VisionModels.TOOLS.keys.toList())
    assertEquals(
      ModelFile(
        "u2netp.onnx", "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx", 4_574_861L,
        "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8",
      ),
      VisionModels.TOOLS["object"],
    )
    assertEquals(
      ModelFile(
        "modnet.onnx", "https://huggingface.co/Xenova/modnet/resolve/fa2fa546052fba4c08921230a26cc69a333fca12/onnx/model.onnx",
        25_888_640L, "07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9",
      ),
      VisionModels.TOOLS["person"],
    )
    val esrgan = VisionModels.TOOLS.getValue("upscale")
    assertEquals("realesr-general-x4v3-t176.onnx", esrgan.name)
    assertEquals(4_866_394L, esrgan.bytes)
    assertEquals("1c1bda585a8b044760e807d4e454b0a2f4bf0c0f0096ff4d8046c422e54f5ce0", esrgan.sha256)
    assertEquals("https://apps-hub-store.haroonmukhtar4.workers.dev/models/${esrgan.sha256}", esrgan.url)
  }

  @Test
  fun toolsListReadinessAndInstallOnlyKnownNames() {
    val dir = Files.createTempDirectory("vision").toFile()
    val rows = VisionModels.tools(dir)
    assertEquals(listOf("person", "object", "upscale"), rows.map { it["tool"] })
    assertEquals(VisionModels.TOOLS.values.map { it.name }, rows.map { it["name"] })
    rows.forEach { assertEquals(false, it["ready"]) }
    File(dir, "other.onnx.part").writeText("x")
    assertFalse(VisionModels.install(dir, "other.onnx"))
    File(dir, "u2netp.onnx.part").writeText("not the model")
    assertFalse(VisionModels.install(dir, "u2netp.onnx"))
    assertFalse(File(dir, "u2netp.onnx.part").exists())
    assertTrue(File(dir, "other.onnx.part").exists())
  }
}
