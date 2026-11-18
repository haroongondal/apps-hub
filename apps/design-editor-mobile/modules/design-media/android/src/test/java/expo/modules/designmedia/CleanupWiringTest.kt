package expo.modules.designmedia

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

// Source scans for the Android-only glue of Clean up and photo search, which can't run on the JVM.
class CleanupWiringTest {
  private val src = File(requireNotNull(System.getProperty("module.src")), "expo/modules/designmedia")

  private fun read(path: String) = File(src, path).readText()

  @Test
  fun trashResultsCarryTheUrisSent() {
    val trash = read("android/CleanupTrash.kt")
    assertTrue(trash.contains("resolve(trashAnswer(pending.action, pending.uris))"))
    assertTrue(!trash.contains("answer(action, 0)") && !trash.contains("answer(pending.action, 0)"))
  }

  // Dialog said OK but the record write failed: the photos are in Android's trash, so Undo still gets the URIs.
  @Test
  fun failedRecordWriteStillResolvesWithTheUris() {
    val trash = read("android/CleanupTrash.kt")
    assertTrue(trash.contains("resolve(trashAnswer(pending.action, pending.uris, noted = false))"))
    assertTrue(!trash.contains("TrashNotNoted"))
  }

  @Test
  fun undismissIsWiredLikeDismiss() {
    assertTrue(read("DesignMediaModule.kt").contains(
      "AsyncFunction(\"undismissCleanup\") { kind: String, uris: List<String> -> CleanupTool.undismiss(context, kind, uris) }.runOnQueue(readScope)"))
    val tool = read("android/CleanupTool.kt").substringAfter("fun undismiss(").substringBefore("\n  }")
    assertTrue(tool.contains("kindOf(kind) ?: throw UnknownCleanupKind(kind)"))
    assertTrue(tool.contains("idOf(it) ?: throw NotAGalleryPhoto()"))
  }

  @Test
  fun photoStateReportsTheLastScan() =
    assertTrue(read("android/PhotoSearch.kt").contains("\"lastScan\" to PhotoIndexRunner.stampFile(ctx).lastModified()"))

  // The trash record is the only way back to a trashed photo, so its bytes are synced before the move.
  @Test
  fun cleanupRecordsAreSynced() = assertTrue(read("core/CleanupStore.kt").contains("it.fd.sync()"))
}
