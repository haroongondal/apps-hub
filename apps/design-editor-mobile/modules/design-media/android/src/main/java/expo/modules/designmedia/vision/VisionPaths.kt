package expo.modules.designmedia.vision

import java.io.File
import java.io.IOException

// The page names files by path, so every path and id is checked before it is opened or written.
object VisionPaths {
  private val ID = Regex("[A-Za-z0-9_-]{1,64}")

  // Absolute only; symlinks and .. are resolved before the folder check. The caller opens the returned canonical file,
  // not the path it was given.
  fun resolve(cacheDir: File, path: String): File? {
    val f = File(path)
    if (!f.isAbsolute) return null
    return try {
      val root = cacheDir.canonicalFile
      f.canonicalFile.takeIf { it != root && it.toPath().startsWith(root.toPath()) }
    } catch (e: IOException) {
      null
    }
  }

  fun allowed(cacheDir: File, path: String): Boolean = resolve(cacheDir, path) != null

  fun output(cacheDir: File, id: String): File {
    require(ID.matches(id)) { "bad vision id" }
    return File(File(cacheDir, "vision"), "$id.png")
  }
}
