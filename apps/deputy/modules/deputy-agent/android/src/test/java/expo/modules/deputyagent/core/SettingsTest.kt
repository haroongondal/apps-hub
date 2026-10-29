package expo.modules.deputyagent.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingsTest {
  private val now = 1_793_268_900_000L // 2026-10-29
  private fun form(vararg changes: Pair<String, Any?>) = Settings().toMap(now) + changes
  private fun rejects(vararg changes: Pair<String, Any?>): String =
    assertThrows(IllegalArgumentException::class.java) { Settings.fromMap(form(*changes)) }.message!!

  @Test fun defaultsToGeminiFlashLiteWithItsPricesAndThePrdCaps() {
    val s = Settings()
    assertEquals("https://generativelanguage.googleapis.com/v1beta/openai/", s.baseUrl)
    assertEquals("gemini-3.5-flash-lite", s.model)
    assertEquals(Prices(0.30, 0.03, 2.50), s.prices(now))
    assertEquals(Caps(), s.caps)
  }

  @Test fun theScreenSeesTheEffectivePricesButOnlyCustomOnesAreKept() {
    val m = Settings().toMap(now)
    assertEquals(false, m["customPrices"])
    assertEquals(0.30, m["inputPerM"])
    assertNull("default prices aren't stored, so a later change to them reaches the owner", Settings.fromMap(m).prices)
  }

  @Test fun customPricesAndCapsSurviveTheStoredJson() {
    val s = Settings.fromMap(
      form(
        "baseUrl" to " https://openrouter.ai/api/v1 ", "model" to "google/gemini-3.1-flash-lite",
        "customPrices" to true, "inputPerM" to 0.25, "cachedPerM" to 0.0, "outputPerM" to 1.5,
        "maxSteps" to 20.0, "maxCostUsd" to 0.5, "maxMinutes" to 5.0, "dailyCostUsd" to 2.0,
      ),
    )
    assertEquals("https://openrouter.ai/api/v1", s.baseUrl)
    assertEquals(Prices(0.25, 0.0, 1.5), s.prices)
    assertEquals(Caps(maxSteps = 20, maxCostUsd = 0.5, maxMillis = 5 * 60_000L, dailyCostUsd = 2.0), s.caps)
    assertEquals(s, Settings.fromJson(s.toJson(now)))
  }

  @Test fun theKeyOnlyGoesOverHttps() {
    assertTrue(rejects("baseUrl" to "http://192.168.1.5:11434/v1").contains("https://"))
    rejects("baseUrl" to "https://")
    rejects("baseUrl" to "generativelanguage.googleapis.com")
  }

  @Test fun theModelIsOneWord() {
    rejects("model" to " ")
    rejects("model" to "gemini 3.8 flash")
  }

  @Test fun pricesMustBeNumbersAndOnlyCachedInputMayBeFree() {
    rejects("customPrices" to true, "inputPerM" to -1.0)
    rejects("customPrices" to true, "outputPerM" to Double.NaN)
    rejects("customPrices" to true, "cachedPerM" to null)
    rejects("customPrices" to true, "inputPerM" to 0.0)
    rejects("customPrices" to true, "outputPerM" to 0.0)
    assertEquals(0.0, Settings.fromMap(form("customPrices" to true, "cachedPerM" to 0.0)).prices!!.cachedPerM, 0.0)
  }

  @Test fun groqsGptOssIsKnownSoItNeedsNoPricesSeesNoImagesAndThinksLittle() {
    val s = Settings.fromMap(form("baseUrl" to Settings.GROQ_URL, "model" to "openai/gpt-oss-120b"))
    assertEquals(Prices(0.15, 0.075, 0.60), s.prices(now))
    assertFalse(s.images)
    assertEquals("low", s.effort)
    assertEquals("GPT-OSS 120B on Groq", s.toMap(now)["knownModel"])
    assertFalse("Groq documents its address without the slash", Settings.fromMap(form("baseUrl" to "https://api.groq.com/openai/v1", "model" to "openai/gpt-oss-120b")).images)
  }

  @Test fun anUnknownModelIsAssumedToSeeImagesAndKeepsTheServicesThinkingLevel() {
    val s = Settings.fromMap(form("model" to "gemini-3.1-pro", "customPrices" to true))
    assertTrue(s.images)
    assertNull(s.effort)
    assertEquals("", s.toMap(now)["knownModel"])
  }

  @Test fun anotherModelOrAddressNeedsItsOwnPrices() {
    assertTrue(rejects("model" to "gemini-3.1-pro").contains("prices"))
    rejects("baseUrl" to "https://openrouter.ai/api/v1")
    assertEquals("gemini-3.1-pro", Settings.fromMap(form("model" to "gemini-3.1-pro", "customPrices" to true)).model)
  }

  @Test fun aKeyOnlyWorksForTheAddressItWasSavedFor() {
    val openRouter = Settings(baseUrl = "https://openrouter.ai/api/v1")
    assertTrue("a key saved before Phase 3 was for Gemini", Settings().ownsKeySavedFor(null))
    assertTrue(openRouter.ownsKeySavedFor("https://openrouter.ai/api/v1"))
    assertFalse(Settings().ownsKeySavedFor("https://openrouter.ai/api/v1"))
    assertFalse(openRouter.ownsKeySavedFor(null))
  }

  @Test fun capsStayInARangeThatStillStopsARun() {
    assertTrue(rejects("maxSteps" to 0.0).contains("1 to 100"))
    rejects("maxSteps" to 101.0)
    rejects("maxSteps" to 2.5)
    rejects("maxCostUsd" to 0.0)
    rejects("maxMinutes" to Double.POSITIVE_INFINITY)
    rejects("maxMinutes" to 1.5)
    rejects("dailyCostUsd" to null)
  }

  @Test fun unreadableStoredSettingsFallBackToDefaults() {
    assertEquals(Settings(), Settings.fromJson("{not json"))
    assertEquals(Settings(), Settings.fromJson("""{"baseUrl":"http://evil.example"}"""))
  }
}
