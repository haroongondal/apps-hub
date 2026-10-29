package expo.modules.deputyagent.core

import java.net.URI
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject

/** FR-5 and FR-6: what the owner can change. `prices` stays null until the owner sets them, so Gemini 3.5 Flash-Lite's prices apply. */
data class Settings(
  val baseUrl: String = GEMINI_URL,
  val model: String = GEMINI_MODEL,
  val prices: Prices? = null,
  val caps: Caps = Caps(),
) {
  fun prices(now: Long) = prices ?: Prices.geminiFlashLite

  /** A key saved before Phase 3 has no address and was a Gemini key. */
  fun ownsKeySavedFor(url: String?) = (url ?: GEMINI_URL) == baseUrl

  fun toMap(now: Long): Map<String, Any> {
    val p = prices(now)
    return mapOf(
      "baseUrl" to baseUrl, "model" to model, "customPrices" to (prices != null),
      "inputPerM" to p.inputPerM, "cachedPerM" to p.cachedPerM, "outputPerM" to p.outputPerM,
      "maxSteps" to caps.maxSteps, "maxCostUsd" to caps.maxCostUsd, "maxMinutes" to caps.maxMillis / 60_000, "dailyCostUsd" to caps.dailyCostUsd,
    )
  }

  fun toJson(now: Long): String = JsonObject(
    toMap(now).mapValues { (_, v) -> if (v is Boolean) JsonPrimitive(v) else if (v is Number) JsonPrimitive(v) else JsonPrimitive(v.toString()) },
  ).toString()

  companion object {
    const val GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
    const val GEMINI_MODEL = "gemini-3.5-flash-lite"

    fun fromMap(m: Map<String, Any?>): Settings {
      val url = (m["baseUrl"] as? String)?.trim().orEmpty()
      require(url.startsWith("https://") && runCatching { URI(url).host }.getOrNull() != null) {
        "The address must start with https://, so the key never travels unencrypted."
      }
      val model = (m["model"] as? String)?.trim().orEmpty()
      require(model.isNotEmpty() && model.length <= 100 && model.none(Char::isWhitespace)) { "Type the model's name, with no spaces." }
      require(m["customPrices"] == true || (url == GEMINI_URL && model == GEMINI_MODEL)) {
        "Enter this model's prices. Deputy only knows Gemini 3.5 Flash-Lite's, and the cost limits are counted with them."
      }
      val prices = if (m["customPrices"] == true) {
        Prices(price(m, "inputPerM", "input", 0.001), price(m, "cachedPerM", "cached input", 0.0), price(m, "outputPerM", "output", 0.001))
      } else null
      val steps = whole(m, "maxSteps", "The step limit", 100.0)
      return Settings(
        url, model, prices,
        Caps(
          maxSteps = steps.toInt(),
          maxCostUsd = number(m, "maxCostUsd", "The cost limit per task", 0.01, 20.0),
          maxMillis = whole(m, "maxMinutes", "The time limit", 60.0).toLong() * 60_000,
          dailyCostUsd = number(m, "dailyCostUsd", "The daily cost limit", 0.01, 100.0),
        ),
      )
    }

    /** Stored settings that no longer validate fall back to the defaults rather than stopping every run. */
    fun fromJson(json: String): Settings = runCatching {
      fromMap(
        Json.parseToJsonElement(json).jsonObject.mapValues { (_, v) ->
          (v as? JsonPrimitive)?.let { p -> if (p.isString) p.content else p.booleanOrNull ?: p.doubleOrNull }
        },
      )
    }.getOrDefault(Settings())

    private fun price(m: Map<String, Any?>, key: String, name: String, min: Double) = number(m, key, "The $name price", min, 1000.0)

    private fun whole(m: Map<String, Any?>, key: String, name: String, max: Double): Double =
      number(m, key, name, 1.0, max).also { require(it % 1 == 0.0) { "$name must be a whole number." } }

    private fun number(m: Map<String, Any?>, key: String, name: String, min: Double, max: Double): Double {
      val v = (m[key] as? Number)?.toDouble()
      require(v != null && v.isFinite() && v in min..max) { "$name must be a number from ${plain(min)} to ${plain(max)}." }
      return v
    }

    private fun plain(d: Double) = if (d % 1 == 0.0) d.toLong().toString() else d.toString()
  }
}
