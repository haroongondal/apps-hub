package expo.modules.designmedia

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Source scans for the rules Phase 4 adds on top of DataSafetyRulesTest: no location tag, FFmpeg read-only
// and offline, Clear queue and Share never touching a person's files.
class Phase4RulesTest {
  private val moduleSrc = File(requireNotNull(System.getProperty("module.src")))
  private val sources get() = moduleSrc.walkTopDown().filter { it.extension == "kt" }.toList()
  private fun source(name: String) = sources.single { it.name == name }.readText()
  private fun body(text: String, from: String, to: String) = text.substringAfter(from).substringBefore(to)

  @Test
  fun noOutputCarriesALocationTag() {
    sources.forEach { assertFalse(it.name, Regex("setLocation\\(").containsMatchIn(it.readText())) }
  }

  @Test
  fun ffmpegIsUsedOnlyByItsRunnerAndOnlyToRead() {
    val users = sources.filter { it.readText().contains("com.arthenica") }.map { it.name }
    // Exceptions.kt is the stand-in for the one class the AAR calls but never declares; it imports nothing from the library
    assertEquals(listOf("Exceptions.kt", "FfmpegRunner.kt"), users.sorted())
    assertFalse(source("Exceptions.kt").contains("import com.arthenica"))
    val runner = source("FfmpegRunner.kt")
    assertTrue(runner.contains("getSafParameterForRead"))
    assertFalse(runner.contains("getSafParameterForWrite"))
    assertFalse(Regex("getSafParameter\\(").containsMatchIn(runner))
    assertTrue("output is a plain cache path", runner.contains("req.out.absolutePath"))
  }

  @Test
  fun ffmpegNeverReachesTheTranslationWhisperCameraOrNetworkClasses() {
    val banned = listOf("TranslationProvider", "WhisperKit", "CameraSupport", "GoogleTranslate", "DeepL", "LibreTranslate", "FFprobeKit", "MediaInformation")
    sources.forEach { f -> banned.forEach { assertFalse("${f.name} uses $it", f.readText().contains(it)) } }
  }

  @Test
  fun onlyTheThreeFfmpegToolsRunThroughFfmpeg() {
    val runners = source("Runners.kt")
    assertTrue(runners.contains("is VolumePlan, is ReversePlan, is StabilizePlan -> FfmpegRunner.start"))
    assertEquals(1, Regex("FfmpegRunner\\.start").findAll(runners).count())
  }

  @Test
  fun theFfmpegAarIsPinnedToTheApprovedVersion() {
    val gradle = moduleSrc.resolve("../../../build.gradle").readText()
    assertTrue(gradle.contains("implementation(\"dev.ffmpegkit-maintained:ffmpeg-kit-min:8.1.7\")"))
    assertFalse(Regex("ffmpeg-kit[^\"]*:[^\"]*[+\\[]").containsMatchIn(gradle))
    assertFalse(gradle.contains("ffmpeg-kit-full") || gradle.contains("ffmpeg-kit-gpl") || gradle.contains("com.arthenica"))
  }

  @Test
  fun clearQueueNeverDeletesAnOutputFileOrRow() {
    val service = source("MediaJobService.kt")
    val clear = body(service, "private fun clear()", "private fun pump()")
    assertFalse(clear.contains("Outputs."))
    assertFalse(clear.contains("delete"))
    assertTrue(clear.contains("cancel(ALL)"))
    assertTrue(clear.contains("store.save(emptyList())"))
    val outputsCalls = Regex("Outputs\\.(\\w+)\\(").findAll(service).map { it.groupValues[1] }.toList()
    assertEquals(listOf("deletePending", "exists", "publish"), outputsCalls.sorted())
    assertTrue(body(service, "override fun onCreate()", "override fun onStartCommand").contains("Outputs.deletePending(this)"))
    assertFalse(source("Outputs.kt").contains("fun delete(") || source("Outputs.kt").contains("deleteOutput"))
  }

  @Test
  fun pausedAndInterruptedJobsComeBackOnResume() {
    val service = source("MediaJobService.kt")
    assertTrue(service.contains("ACTION_RESUME -> record(QueueEvent.Resume)"))
    assertTrue(service.contains("fun resume(context: Context) = send(context, ACTION_RESUME)"))
  }

  @Test
  fun shareAndOpenGiveOneFileAReadGrantAndNothingMore() {
    val intents = source("Intents.kt")
    assertTrue(intents.contains("Intent.createChooser("))
    assertEquals(3, Regex("FLAG_GRANT_READ_URI_PERMISSION").findAll(intents).count())
    assertEquals(2, Regex("FLAG_ACTIVITY_NEW_TASK").findAll(intents).count())
    assertFalse(intents.contains("FLAG_GRANT_WRITE") || intents.contains("FLAG_GRANT_PERSISTABLE"))
  }

  @Test
  fun thumbnailsAndGifFramesNeverLeaveTheCacheOrTheBridge() {
    val module = source("DesignMediaModule.kt")
    assertTrue(module.contains("Thumbs.write("))
    // every folder is under the cache, and the cleanup only looks inside the folder it wrote to
    assertTrue(source("Thumbs.kt").contains("folder: String = \"thumbs\""))
    assertTrue(source("Thumbs.kt").contains("File(context.cacheDir, folder)"))
    assertTrue(source("Thumbs.kt").contains("it !in made"))
  }
}
