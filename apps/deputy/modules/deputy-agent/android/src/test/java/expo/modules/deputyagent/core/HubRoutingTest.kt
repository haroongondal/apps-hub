package expo.modules.deputyagent.core

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Source pins: the hub changes where a step is asked, never the gate, the prompt or the untrusted block.
class HubRoutingTest {
  private val main = File("src/main/java/expo/modules/deputyagent")
  private val kotlin = main.walkTopDown().filter { it.extension == "kt" }.toList()
  private fun src(path: String) = File(main, path).also { assertTrue("missing $it", it.isFile) }.readText()

  @Test fun theHubClientIsBuiltInOnePlaceAndHubFirstIsWiredInOne() {
    assertEquals(listOf("HubLink.kt"), kotlin.filter { "AiHubClient(" in it.readText() }.map { it.name })
    assertEquals(listOf("AgentRuntime.kt"), kotlin.filter { "HubFirst(" in it.readText() && it.name != "HubFirst.kt" }.map { it.name })
  }

  @Test fun theGatePolicyPromptAndLoopNameNeitherTheHubNorItsClient() {
    for (f in listOf("core/Gate.kt", "core/Policy.kt", "core/Prompt.kt", "core/TrustTable.kt", "core/ObservationBuilder.kt", "core/AgentLoop.kt")) {
      val text = src(f).lowercase()
      for (w in listOf("hubfirst", "aihub", "ai hub", "hubcall")) assertFalse("$f mentions $w", w in text)
    }
  }

  @Test fun theKeyTestStaysOnTheOwnKey() {
    val test = src("android/AgentRuntime.kt").substringAfter("suspend fun testProvider(").substringBefore("fun history(")
    assertTrue("OpenAiCompatProvider(" in test)
    assertFalse("HubFirst" in test)
  }

  @Test fun nothingInTheHubPathLogsAPromptOrAScreenshot() {
    for (f in listOf("core/HubFirst.kt", "android/HubLink.kt")) {
      val text = src(f)
      for (w in listOf("Log.", "println", "Timber", "printStackTrace")) assertFalse("$f uses $w", w in text)
    }
  }

  @Test fun theScreenshotFileIsDeletedAfterItsCallAndSweptAtStart() {
    val link = src("android/HubLink.kt")
    assertTrue(link.substringAfter("finally {").contains("file.delete()"))
    assertTrue(src("android/AgentRuntime.kt").contains("HubLink.sweep(app)"))
  }
}
