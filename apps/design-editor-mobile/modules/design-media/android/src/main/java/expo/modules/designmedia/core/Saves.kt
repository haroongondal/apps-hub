package expo.modules.designmedia.core

import java.util.Locale

// Rules for where the editor's saveFile posts land on the phone (SPEC §14.3): image exports
// (png/jpg) go to Pictures/Design Editor; every other format — .json designs, svg, pdf — goes
// to Documents/Design Editor. The paths are MediaStore RELATIVE_PATH roots, so the Files app
// shows them next to Movies/Design Editor. Tested on their own in SavesTest; the MediaStore
// plumbing that consumes them lives in android/DesignSaves.kt.
object Saves {
  data class Target(val folder: String, val mime: String, val images: Boolean)

  const val DOC_FOLDER = "Documents/Design Editor/"
  const val PIC_FOLDER = "Pictures/Design Editor/"

  fun target(ext: String): Target = when (ext.lowercase(Locale.US)) {
    "png" -> Target(PIC_FOLDER, "image/png", images = true)
    "jpg", "jpeg" -> Target(PIC_FOLDER, "image/jpeg", images = true)
    "svg" -> Target(DOC_FOLDER, "image/svg+xml", images = false)
    "pdf" -> Target(DOC_FOLDER, "application/pdf", images = false)
    "json" -> Target(DOC_FOLDER, "application/json", images = false)
    else -> Target(DOC_FOLDER, "application/octet-stream", images = false)
  }

  // The page passes its current filePath back on Save (not Save as). When that path points at
  // one of our own folders with the same basename, the file this app wrote before is replaced
  // in place — the desktop overwrites too, so the title never accumulates "Poster (1).json".
  // Rows the query misses fall back to an insert in DesignSaves.
  fun replaces(filePath: String?, name: String): Boolean {
    if (filePath == null) return false
    val trimmed = filePath.trimStart('/')
    if (trimmed != DOC_FOLDER && trimmed != PIC_FOLDER && !trimmed.startsWith(DOC_FOLDER) && !trimmed.startsWith(PIC_FOLDER)) return false
    val path = trimmed.substringAfterLast('/')
    return path == name
  }
}
