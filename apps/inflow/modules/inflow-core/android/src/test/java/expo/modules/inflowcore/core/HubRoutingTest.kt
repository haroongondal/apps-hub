package expo.modules.inflowcore.core

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Source pins for the hub-only change: AI hub is the one way out, and health text goes through it only from the two owner-driven paths.
class HubRoutingTest {
  private val main = File("src/main/java/expo/modules/inflowcore")
  private fun src(path: String) = File(main, path).also { assertTrue("missing $it from ${File(".").absoluteFile}", it.isFile) }.readText()
  private val kotlin = main.walkTopDown().filter { it.extension == "kt" }.toList()
  private val healthWords = listOf("SqlHealthStore", "SqlMedicineStore", "SqlJournalStore", "HealthForAsk", "HealthAggregate", "BriefingHealth", "DoctorPayload")

  @Test fun theHubClientIsBuiltInOnePlaceOnly() {
    assertEquals(sortedSetOf("AiConfig.kt"), kotlin.filter { "AiHubClient(" in it.readText() }.map { it.name }.toSortedSet())
  }

  @Test fun noOwnProviderKeyOrAddressIsLeft() {
    val gone = listOf("OpenAiCompatProvider", "HubFirst", "HubPause", "HttpURLConnection", "api.groq.com", "generativelanguage", "Bearer ", "INSERT INTO ai_keys", "AiModels", "ownProvider")
    // AiSwitch.kt alone names Google's address, only to read which old keys were the active ones after the upgrade; nothing is sent there.
    for (f in kotlin) for (w in gone) assertFalse("${f.name} mentions $w", w in f.readText() && !(f.name == "AiSwitch.kt" && w == "generativelanguage"))
  }

  @Test fun theOnlyWayToDeleteAKeyIsTheHubAnsweredCleanup() {
    val users = kotlin.filter { "DELETE FROM ai_keys" in it.readText() }.map { it.name }
    assertEquals(listOf("AiConfig.kt"), users)
    assertEquals(listOf("AiSwitch.kt"), kotlin.filter { "keys.deleteAll()" in it.readText() }.map { it.name })
  }

  @Test fun onlyAskAndTheDoctorSummaryTouchBothHealthDataAndAnAiProvider() {
    val both = kotlin.filter { f -> f.readText().let { t -> healthWords.any { it in t } && (".provider(" in t || "TextAi" in t || ".hub(" in t) } }.map { it.name }.toSortedSet()
    assertEquals(sortedSetOf("AiRunner.kt", "AskRun.kt", "DoctorRunner.kt"), both)
  }

  @Test fun theBackgroundBatchCategoriserAndReportsNeverNameHealthData() {
    for (f in listOf("core/AiQueue.kt", "core/TxnCategorize.kt", "core/Reports.kt", "core/Ai.kt")) {
      val text = src(f)
      for (w in healthWords) assertFalse("$f mentions $w", w in text)
    }
    val background = src("android/AiRunner.kt").substringAfter("private fun execute(").substringBefore("fun ask(")
    for (w in healthWords) assertFalse("the background run mentions $w", w in background)
  }

  @Test fun askBuildsHealthOnlyFromItsSwitch() {
    val ask = src("android/AiRunner.kt").substringAfter("fun ask(")
    val switchRead = "val healthOn = HealthForAsk.on(store.meta(HealthForAsk.META))"
    assertTrue(switchRead in ask)
    assertTrue(ask.indexOf(switchRead) < ask.indexOf("HealthForAsk.context(healthOn,"))
    val calls = kotlin.filter { it.name != "HealthForAsk.kt" }.sumOf { Regex("""HealthForAsk\.context\(""").findAll(it.readText()).count() }
    assertEquals(1, calls)
  }

  @Test fun theDoctorSummaryRunsOnlyFromItsTwoModuleFunctions() {
    assertEquals(listOf("DoctorRunner.kt", "InflowCoreModule.kt"), kotlin.filter { "DoctorRunner" in it.readText() }.map { it.name }.sorted())
    assertEquals(2, Regex("""DoctorRunner\.of\(""").findAll(File(main, "InflowCoreModule.kt").readText()).count())
    assertTrue(src("InflowCoreModule.kt").contains("DoctorRunner.of(context, store()).summarize("))
  }
}
