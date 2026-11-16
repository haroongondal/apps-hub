package expo.modules.inflowcore.android

import expo.modules.inflowcore.core.AiMeta
import expo.modules.inflowcore.core.AiReply
import expo.modules.inflowcore.core.AiModels
import expo.modules.inflowcore.core.HttpReply
import expo.modules.inflowcore.core.OpenAiCompatProvider
import expo.modules.inflowcore.core.Prices
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject

/** The owner's AI settings, kept in meta and the ai_* tables of the SQLCipher database (R23). Nothing here logs a key, a prompt or a reply. */
class AiConfig(private val store: SqlItemStore) {
  fun baseUrl(): String = store.meta(AiMeta.BASE_URL)?.takeIf { it.isNotBlank() } ?: AiModels.KNOWN.first().baseUrl

  fun model(): String = store.meta(AiMeta.MODEL)?.takeIf { it.isNotBlank() } ?: AiModels.KNOWN.first().model

  fun known() = AiModels.known(baseUrl(), model())

  fun prices(): Prices = customPrices() ?: known()?.prices ?: AiModels.KNOWN.first().prices

  fun setModel(baseUrl: String, model: String, prices: Prices?) {
    store.inTransaction {
      store.setMeta(AiMeta.BASE_URL, baseUrl.trim())
      store.setMeta(AiMeta.MODEL, model.trim())
      if (prices == null) store.deleteMeta(AiMeta.CUSTOM_PRICES)
      else store.setMeta(
        AiMeta.CUSTOM_PRICES,
        JsonObject(mapOf("inputPerM" to JsonPrimitive(prices.inputPerM), "cachedPerM" to JsonPrimitive(prices.cachedPerM), "outputPerM" to JsonPrimitive(prices.outputPerM))).toString(),
      )
    }
  }

  private fun customPrices(): Prices? = runCatching {
    val o = Json.parseToJsonElement(store.meta(AiMeta.CUSTOM_PRICES) ?: return null).jsonObject
    fun d(k: String) = (o[k] as JsonPrimitive).doubleOrNull!!
    Prices(d("inputPerM"), d("cachedPerM"), d("outputPerM"))
  }.getOrNull()

  /** null = no limit. */
  fun capUsd(): Double? = when (val v = store.meta(AiMeta.CAP_USD)) {
    null, "" -> DEFAULT_CAP_USD
    "none" -> null
    else -> v.toDoubleOrNull() ?: DEFAULT_CAP_USD
  }

  fun setCap(usd: Double?) = store.setMeta(AiMeta.CAP_USD, usd?.toString() ?: "none")

  /** Keys saved for this address only: a key never goes to another address. */
  fun keys(baseUrl: String = baseUrl()): List<Pair<Long, String>> =
    store.query("SELECT id, api_key FROM ai_keys WHERE base_url = ? ORDER BY id", baseUrl).use { c ->
      buildList { while (c.moveToNext()) add(c.getLong(0) to c.getString(1)) }
    }

  fun on(): Boolean = keys().isNotEmpty()

  /** The first key ever added sets aiSince: only items posted from then on are sent. */
  fun addKey(key: String) {
    store.inTransaction {
      if (keys().none { it.second == key }) store.run("INSERT INTO ai_keys(base_url, api_key) VALUES (?, ?)", baseUrl(), key)
      if (store.enabledSince() == null) store.setMeta(AiMeta.SINCE, System.currentTimeMillis().toString())
    }
  }

  fun removeKey(id: Long) {
    store.run("DELETE FROM ai_keys WHERE id = ?", id)
  }

  fun blocks(): List<String> =
    store.query("SELECT block_key FROM ai_blocks ORDER BY block_key").use { c -> buildList { while (c.moveToNext()) add(c.getString(0)) } }

  fun setBlocked(key: String, blocked: Boolean) {
    if (blocked) store.run("INSERT OR IGNORE INTO ai_blocks(block_key) VALUES (?)", key) else store.run("DELETE FROM ai_blocks WHERE block_key = ?", key)
  }

  /** Null when there is no key for the saved address, or the address is not https (the key would travel unencrypted). */
  fun provider(onlyKeyId: Long? = null): OpenAiCompatProvider? {
    val url = baseUrl()
    if (!url.startsWith("https://")) return null
    val keys = keys(url).filter { onlyKeyId == null || it.first == onlyKeyId }.map { it.second }
    if (keys.isEmpty()) return null
    return OpenAiCompatProvider(url, model(), keys, known()?.effort, AiHttp::post)
  }

  fun today(): String = LocalDate.ofInstant(Instant.now(), ZoneId.systemDefault()).toString()

  fun spend(reply: AiReply) = store.addSpend(today(), prices().cost(reply))

  fun status(): Map<String, Any?> = mapOf(
    "baseUrl" to baseUrl(), "model" to model(), "knownModel" to known()?.name,
    "keys" to keys().map { mapOf("id" to it.first, "ending" to it.second.takeLast(4)) },
    "capUsd" to capUsd(), "spentTodayUsd" to store.spentToday(today()), "queued" to store.queuedCount(),
    "lastRunAt" to store.meta(AiMeta.LAST_RUN_AT)?.toLongOrNull(), "error" to store.meta(AiMeta.ERROR)?.takeIf { it.isNotBlank() }, "on" to on(),
  )

  companion object {
    const val DEFAULT_CAP_USD = 0.50
  }
}

/** The one place a request leaves the phone: a POST to an https address (never redirected), 20 s to connect, 60 s to read. IOException means the network failed. */
object AiHttp {
  fun post(url: String, headers: Map<String, String>, body: String): HttpReply {
    val c = URL(url).openConnection() as HttpURLConnection
    try {
      c.requestMethod = "POST"
      c.instanceFollowRedirects = false   // a 3xx is a refused request: the key must never follow a redirect to another address
      c.connectTimeout = 20_000
      c.readTimeout = 60_000
      c.doOutput = true
      headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
      c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      val code = c.responseCode
      val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
      val retryAfterMs = c.getHeaderField("retry-after")?.trim()?.toLongOrNull()?.times(1_000)
      return HttpReply(code, text, retryAfterMs)
    } finally {
      c.disconnect()
    }
  }
}
