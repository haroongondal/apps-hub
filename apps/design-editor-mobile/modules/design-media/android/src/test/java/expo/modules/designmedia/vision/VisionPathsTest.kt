package expo.modules.designmedia.vision

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class VisionPathsTest {
  @get:Rule val folder = TemporaryFolder()

  @Test
  fun visionPathsAllowOnlyTheCacheFolder() {
    val cache = folder.newFolder("cache")
    val files = folder.newFolder("files")
    File(cache, "vision").mkdir()
    File(files, "models").mkdir()
    assertTrue(VisionPaths.allowed(cache, File(cache, "vision/a.png").path))
    assertTrue(VisionPaths.allowed(cache, "file://" + File(cache, "vision/a.png").path))
    assertFalse(VisionPaths.allowed(cache, "file://" + File(files, "models/x").path))
    assertFalse(VisionPaths.allowed(cache, "file://vision/a.png"))
    // The runner opens the resolved canonical file, so a link swapped in after the check is not followed again.
    assertEquals(File(cache, "vision/a.png").canonicalFile, VisionPaths.resolve(cache, File(cache, "vision/./x/../a.png").path))
    assertFalse(VisionPaths.allowed(cache, File(files, "models/u2netp.onnx").path))
    assertFalse(VisionPaths.allowed(cache, File(cache, "vision/../../files/x").path))
    assertFalse(VisionPaths.allowed(cache, cache.path))
    assertFalse(VisionPaths.allowed(cache, "cache/vision/a.png"))
    val link = File(cache, "vision/link")
    Files.createSymbolicLink(link.toPath(), File(files, "models").toPath())
    assertFalse(VisionPaths.allowed(cache, File(link, "u2netp.onnx").path))
    // A sibling whose name merely starts with "cache" is outside it.
    assertFalse(VisionPaths.allowed(cache, folder.newFolder("cache2").path + "/a.png"))
  }

  @Test
  fun outputStaysInTheVisionFolder() {
    val cache = folder.newFolder("cache")
    assertEquals(File(cache, "vision/job-1.png"), VisionPaths.output(cache, "job-1"))
    listOf("../x", "a/b", "", ".", "x".repeat(65)).forEach {
      assertThrows(it, IllegalArgumentException::class.java) { VisionPaths.output(cache, it) }
    }
  }
}
