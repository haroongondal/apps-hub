package expo.modules.designmedia.vision

import java.io.File
import java.io.IOException

// The page names files by path, so every path and id is checked before it is opened or written.
object VisionPaths {
  private val ID = Regex("[A-Za-z0-9_-]{1,64}")

  // Absolute only; symlinks and .. are resolved before the folder check.
  fun allowed(cacheDir: File, path: String): Boolean {
    val f = File(path)
    if (!f.isAbsolute) return false
    return try {
      val root = cacheDir.canonicalFile
      val real = f.canonicalFile
      real != root && real.toPath().startsWith(root.toPath())
    } catch (e: IOException) {
      false
    }
  }

  fun output(cacheDir: File, id: String): File {
    require(ID.matches(id)) { "bad vision id" }
    return File(File(cacheDir, "vision"), "$id.png")
  }
}
