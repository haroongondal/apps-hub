package expo.modules.designmedia

import expo.modules.designmedia.core.AtomicFile
import expo.modules.designmedia.core.Next
import expo.modules.designmedia.core.decodeSizePlan
import expo.modules.designmedia.core.nextSizeAttempt
import java.io.File
import java.io.IOException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

// PRD §5, one test per rule. Rules 3 and 4 run code; 1, 2, 5 and 6 are source scans, since they have no runtime seam.
class DataSafetyRulesTest {
  @get:Rule val folder = TemporaryFolder()

  private val moduleSrc = File(requireNotNull(System.getProperty("module.src")))

  private val sources: List<File>
    get() = moduleSrc.walkTopDown().filter { it.extension == "kt" }.toList()

  private fun source(name: String): String = sources.single { it.name == name }.readText()

  private fun sourcesContaining(needle: String): List<String> = sources.filter { it.readText().contains(needle) }.map { it.name }

  @Test
  fun rule1OriginalsAreOpenedReadOnly() {
    val writeMode = Regex("\"(w|rw|wt|wa)\"")
    sources.forEach { assertFalse(it.name, writeMode.containsMatchIn(it.readText())) }
    // Outputs.kt (video exports, Phase 1) and DesignSaves.kt (designs and export files, Phase 3)
    // are the two MediaStore writers; both only ever write brand-new or own-row files
    assertEquals(setOf("Outputs.kt", "DesignSaves.kt"), sourcesContaining("openOutputStream(").toSet())
    assertTrue(source("Outputs.kt").contains("resolver.insert(collection, values)"))
  }

  @Test
  fun rule2WritesStayInMediaStoreAndTheAppsOwnStorage() {
    val forbidden = listOf("getExternalStorage", "getExternalFilesDir", "DIRECTORY_", "/sdcard", "/storage/emulated")
    sources.forEach { file -> forbidden.forEach { assertFalse("${file.name} uses $it", file.readText().contains(it)) } }
  }

  @Test
  fun rule3NothingAboveTheTargetIsPublished() {
    val text = File(System.getProperty("fixtures.dir"), "retry-cases.json").readText()
    val case = Json.parseToJsonElement(text).jsonObject.getValue("cases").jsonArray[0].jsonObject
    val plan = decodeSizePlan(case.getValue("plan").jsonObject)
    val above = listOf(plan.targetBytes + 1, plan.targetBytes + 1_000, plan.targetBytes * 115 / 100, plan.targetBytes * 2)
    above.forEach { assertFalse("actual $it", nextSizeAttempt(plan, it) is Next.Publish) }
    assertTrue(nextSizeAttempt(plan, plan.targetBytes) is Next.Publish)
    assertEquals(1, Regex("Outputs\\.publish\\(").findAll(source("MediaJobService.kt")).count())
    assertTrue(source("MediaJobService.kt").contains("is Next.Publish -> publish(r, out)"))
  }

  @Test
  fun rule4APartialWriteNeverReplacesTheFileAndLeavesNoHalfFile() {
    val target = folder.newFile("queue.json").apply { writeText("old") }
    val tmp = File(folder.root, "queue.json.tmp").apply { mkdir() }
    assertThrows(IOException::class.java) { AtomicFile(target).write("new") }
    assertEquals("old", target.readText())
    tmp.delete()
    AtomicFile(target).write("new")
    assertEquals("new", target.readText())
    assertFalse(File(folder.root, "queue.json.tmp").exists())
  }

  @Test
  fun rule5MediaBytesNeverCrossTheBridge() {
    val module = source("DesignMediaModule.kt")
    listOf("ByteArray", "ByteBuffer", "Bitmap", "Base64", "readBytes", "writeBytes").forEach {
      assertFalse(it, module.contains(it))
    }
  }

  @Test
  fun rule6MediaJobsNeverTouchTheNetwork() {
    val network = listOf("java.net", "HttpURLConnection", "okhttp", "openConnection", "Socket(", "URL(")
    sources.forEach { file -> network.forEach { assertFalse("${file.name} uses $it", file.readText().contains(it)) } }
    val gradle = moduleSrc.resolve("../../../build.gradle").readText()
    assertFalse(gradle.contains("okhttp"))
  }
}
