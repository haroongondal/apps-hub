package expo.modules.inflowcore.core

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Source pins: AI hub may fall back to Gemini, so the Doctor summary and anything carrying health data must stay on the owner's own key.
class HubRoutingTest {
  private val main = File("src/main/java/expo/modules/inflowcore")
  private fun src(path: String) = File(main, path).also { assertTrue("missing $it from ${File(".").absoluteFile}", it.isFile) }.readText()
  private val hubWords = listOf("HubFirst", "AiHubClient", "aihubclient", "cfg.provider(", ".provider(")

  @Test fun theHubIsBuiltInOnePlaceOnly() {
    val users = main.walkTopDown().filter { it.extension == "kt" }
      .filter { f -> f.readText().let { "AiHubClient(" in it || "HubFirst(" in it } }
      .map { it.name }.toSortedSet()
    assertEquals(sortedSetOf("AiConfig.kt", "HubFirst.kt"), users)
  }

  @Test fun theDoctorSummaryNeverCallsTheHub() {
    for (f in listOf("android/DoctorRunner.kt", "android/DoctorPdf.kt", "core/DoctorSummary.kt")) {
      val text = src(f)
      for (w in hubWords) assertFalse("$f mentions $w", w in text)
    }
    assertTrue(src("android/DoctorRunner.kt").contains("OpenAiCompatProvider(AiModels.GROQ_URL, MODEL, keys, known.effort, post)"))
  }

  @Test fun healthDataPathsNeverCallTheHub() {
    for (f in listOf("core/HealthForAsk.kt", "core/HealthAggregate.kt", "core/Medicines.kt", "core/Journal.kt", "core/BriefingHealth.kt")) {
      val text = src(f)
      for (w in hubWords) assertFalse("$f mentions $w", w in text)
    }
  }

  @Test fun askWithHealthOnUsesTheOwnKeyForTheWholeAsk() {
    val ask = src("android/AiRunner.kt").substringAfter("fun ask(")
    val choice = "val provider = (if (healthOn) cfg.ownProvider() else cfg.provider(foreground = true))"
    assertTrue(choice in ask)
    assertTrue(ask.indexOf("val healthOn = HealthForAsk.on(store.meta(HealthForAsk.META))") in 0 until ask.indexOf(choice))
    // The answer gets health only from the same flag that picked the own key, and no other provider is made in Ask.
    assertTrue("HealthForAsk.context(healthOn," in ask)
    assertEquals(2, Regex("""\.provider\(|ownProvider\(""").findAll(ask).count())
  }

  @Test fun theKeyTestUsesTheOwnKey() {
    val test = src("android/AiRunner.kt").substringAfter("fun test(").substringBefore("fun ask(")
    assertTrue("cfg.ownProvider(keyId)" in test)
    assertFalse("cfg.provider(" in test)
  }
}
