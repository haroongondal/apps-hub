package expo.modules.aihubcore

import android.content.pm.PackageManager
import expo.modules.aihubcore.android.HubStore
import expo.modules.aihubcore.android.KeyVault
import expo.modules.aihubcore.core.ApiVersion
import expo.modules.aihubcore.core.CallerPolicy
import expo.modules.aihubcore.core.Job
import expo.modules.aihubcore.core.Service
import expo.modules.aihubcore.core.Settings
import expo.modules.aihubcore.core.Usage
import expo.modules.aihubcore.core.labelOf
import expo.modules.aihubcore.core.serviceOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

class AiHubCoreModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext) { "React context unavailable" }
  private val vault by lazy { KeyVault.get(context) }
  private val store by lazy { HubStore.get(context) }
  private val settingsLock = Any()

  override fun definition() = ModuleDefinition {
    Name("AiHubCore")

    Function("apiVersion") { ApiVersion.CURRENT }

    AsyncFunction("keys") { keys() }
    AsyncFunction("addKey") { key: String -> addKey(key) }
    AsyncFunction("removeKey") { index: Int -> vault.remove(index) }
    AsyncFunction("clearKeys") { vault.clear() }

    AsyncFunction("models") { models() }
    AsyncFunction("setModel") { job: String, service: String, model: String -> setModel(job, service, model) }

    AsyncFunction("apps") { apps() }
    AsyncFunction("setAppEnabled") { packageName: String, enabled: Boolean -> setAppEnabled(packageName, enabled) }
  }

  private fun keys(): List<Map<String, Any>> = vault.list().mapIndexed { index, key ->
    mapOf("index" to index, "service" to (serviceOf(key)?.name?.lowercase() ?: ""), "label" to labelOf(key))
  }

  private fun addKey(key: String) {
    val value = key.trim()
    if (serviceOf(value) == null) throw IllegalArgumentException(BAD_KEY)
    vault.add(value)
  }

  private fun models(): Map<String, Map<String, String>> = Settings.models(store.get("models")).entries.associate { (job, c) ->
    job.name.lowercase() to mapOf("service" to Settings.key(c.service), "model" to c.model)
  }

  private fun setModel(jobName: String, serviceName: String, model: String) {
    val job = Job.entries.firstOrNull { it.name.equals(jobName, ignoreCase = true) }
      ?: throw IllegalArgumentException("That job isn't one the hub runs.")
    val service = serviceNamed(serviceName) ?: throw IllegalArgumentException("That service isn't one the hub supports.")
    val id = model.trim()
    if (id.isEmpty()) throw IllegalArgumentException("Enter a model id.")
    if (!Settings.allowed(job, service)) {
      throw IllegalArgumentException("${service.label} can't do this job. Pick ${Service.entries.first { Settings.allowed(job, it) }.label}.")
    }
    synchronized(settingsLock) {
      val key = job.name.lowercase()
      val next = buildJsonObject {
        readObject("models").forEach { (k, v) -> if (k != key) put(k, v) }
        put(key, buildJsonObject {
          put("service", service.name.lowercase())
          put("model", id)
        })
      }
      store.put("models", next.toString())
    }
  }

  private fun apps(): List<Map<String, Any>> {
    val usage = Usage.fromJson(store.get("usage")).apps
    val switches = switches()
    val packages = (usage.keys + switches.keys).filter { it != context.packageName }.sorted()
    return packages.map { pkg ->
      val counts = usage[pkg].orEmpty().values
      mapOf(
        "packageName" to pkg,
        "label" to labelFor(pkg),
        "enabled" to (pkg != CallerPolicy.STRONGROOM && switches[pkg] != false),
        "calls" to counts.sumOf { it.calls },
        "inputTokens" to counts.sumOf { it.inputTokens },
        "outputTokens" to counts.sumOf { it.outputTokens },
        "lastUsed" to (counts.maxOfOrNull { it.lastUsedMs } ?: 0L),
      )
    }
  }

  private fun setAppEnabled(packageName: String, enabled: Boolean) {
    if (packageName.isBlank()) throw IllegalArgumentException("Pick an app first.")
    if (enabled && packageName == CallerPolicy.STRONGROOM) {
      throw IllegalArgumentException("Strongroom is never allowed. Vault data stays in Strongroom.")
    }
    synchronized(settingsLock) {
      val next = buildJsonObject {
        switches().forEach { (k, v) -> if (k != packageName) put(k, v) }
        put(packageName, enabled)
      }
      store.put("app_switches", next.toString())
    }
  }

  private fun switches(): Map<String, Boolean> =
    readObject("app_switches").mapNotNull { (pkg, v) -> runCatching { pkg to v.jsonPrimitive.boolean }.getOrNull() }.toMap()

  private fun readObject(name: String): JsonObject =
    runCatching { Json.parseToJsonElement(store.get(name) ?: "").jsonObject }.getOrDefault(JsonObject(emptyMap()))

  private fun labelFor(pkg: String): String = try {
    val pm = context.packageManager
    pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
  } catch (e: PackageManager.NameNotFoundException) {
    pkg
  }

  private fun serviceNamed(name: String): Service? = Service.entries.firstOrNull { it.name.equals(name, ignoreCase = true) }

  private companion object {
    const val BAD_KEY = "This doesn't look like a Gemini key (AIza… or AQ.…) or a Groq key (gsk_…)."
  }
}
