package expo.modules.designmedia.core

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ClipModelsTest {
  private val abc = ModelFile("m.onnx", "x", 3L, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")

  private fun tmp(): File = Files.createTempDirectory("clip").toFile()

  @Test
  fun sha256OfKnownBytes() {
    val f = File(tmp(), "a").apply { writeBytes("abc".toByteArray()) }
    assertEquals(abc.sha256, ClipModels.sha256Of(f))
  }

  @Test
  fun isReadyNeedsExactLength() {
    val dir = tmp()
    assertFalse(ClipModels.isReady(dir, abc))
    File(dir, abc.name).writeBytes("ab".toByteArray())
    assertFalse(ClipModels.isReady(dir, abc))
    File(dir, abc.name).writeBytes("abc".toByteArray())
    assertTrue(ClipModels.isReady(dir, abc))
    File(dir, abc.name).writeBytes("abcd".toByteArray())
    assertFalse(ClipModels.isReady(dir, abc))
  }

  @Test
  fun pinnedUrlsUseTheRevision() {
    ClipModels.ALL.forEach {
      assertTrue(it.url, it.url.contains("6b7c523703ae26e39be4b03774966f8571c7f523"))
      assertTrue(it.url, it.url.endsWith("/onnx/${it.name}"))
    }
    assertEquals(listOf(ClipModels.VISION, ClipModels.TEXT), ClipModels.ALL)
  }

  @Test
  fun installAcceptsOnlyTheRightBytes() {
    val dir = tmp()
    val part = File(dir, "m.onnx.part")

    part.writeBytes("abc".toByteArray())
    assertTrue(ClipModels.install(dir, abc))
    assertTrue(File(dir, "m.onnx").exists())
    assertFalse(part.exists())
    assertTrue(ClipModels.isReady(dir, abc))

    val bad = tmp()
    File(bad, "m.onnx.part").writeBytes("abd".toByteArray())
    assertFalse(ClipModels.install(bad, abc))
    assertFalse(File(bad, "m.onnx.part").exists())
    assertFalse(File(bad, "m.onnx").exists())

    val short = tmp()
    File(short, "m.onnx.part").writeBytes("ab".toByteArray())
    assertFalse(ClipModels.install(short, abc))
    assertFalse(File(short, "m.onnx.part").exists())

    assertFalse(ClipModels.install(tmp(), abc))
  }
}
