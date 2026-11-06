package expo.modules.designmedia.core

import java.io.File

// The MediaStore rows this queue has inserted and not finished. The start-up cleanup deletes exactly these rows, never
// "every unfinished file in the folder": the editor's own image saves mark a person's existing file unfinished while they
// replace it, in the same Pictures folder (found in review, 2026-11-04).
class PendingLog(private val file: File) {
  fun all(): List<String> = if (file.exists()) file.readLines().map { it.trim() }.filter { it.isNotEmpty() } else emptyList()

  @Synchronized fun add(uri: String) {
    file.appendText(uri + "\n")
  }

  @Synchronized fun remove(uri: String) {
    val rest = all().filter { it != uri }
    if (rest.isEmpty()) file.delete() else file.writeText(rest.joinToString("\n", postfix = "\n"))
  }

  @Synchronized fun clear() {
    file.delete()
  }
}
