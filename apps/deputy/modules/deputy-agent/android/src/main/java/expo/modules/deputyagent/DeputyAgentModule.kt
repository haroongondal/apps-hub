package expo.modules.deputyagent

import android.app.Activity
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PersistableBundle
import android.os.PowerManager
import android.provider.Settings
import android.speech.RecognizerIntent
import expo.modules.deputyagent.android.AgentRuntime
import expo.modules.deputyagent.android.DeputyAccessibilityService
import expo.modules.deputyagent.android.KeyVault
import expo.modules.deputyagent.android.OwnerStore
import expo.modules.deputyagent.android.StopChip
import expo.modules.deputyagent.core.SavedTask
import expo.modules.deputyagent.core.ServiceSetting
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

private const val NOT_CONNECTED =
  "The accessibility service isn't connected. If Setup says it is on, turn it off and on again in Accessibility settings."
private const val RUN_EVENT = "onRunEvent"
private const val SPEECH_REQUEST = 7301

class DeputyAgentModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  private var pendingSpeech: Promise? = null

  private fun open(intent: Intent) = context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))

  override fun definition() = ModuleDefinition {
    Name("DeputyAgent")

    Events(RUN_EVENT)

    OnCreate {
      appContext.reactContext?.let(AgentRuntime::init)
      AgentRuntime.listener = { e -> sendEvent(RUN_EVENT, AgentRuntime.toMap(e)) }
    }

    OnDestroy { AgentRuntime.listener = null }

    Function("getServiceState") {
      val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
      mapOf(
        "accessibilityEnabled" to ServiceSetting.isEnabled(enabled, context.packageName, DeputyAccessibilityService::class.java.name),
        "notificationsAllowed" to context.getSystemService(NotificationManager::class.java).areNotificationsEnabled(),
        "batteryUnrestricted" to context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName),
        "keySet" to KeyVault.has(context, OwnerStore.settings(context)),
        "contactsAllowed" to (context.checkSelfPermission(android.Manifest.permission.READ_CONTACTS) == android.content.pm.PackageManager.PERMISSION_GRANTED),
        "runActive" to AgentRuntime.active,
      )
    }

    Function("openAccessibilitySettings") { open(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }

    Function("openAppInfo") {
      open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
    }

    Function("openBatterySettings") { open(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }

    Function("disableService") { DeputyAccessibilityService.instance?.let { it.disableSelf(); true } ?: false }

    Function("startRun") { task: String, allowedApps: List<String>? ->
      try {
        mapOf("runId" to AgentRuntime.start(context, task, SavedTask.allowList(allowedApps)), "error" to null)
      } catch (e: IllegalStateException) {
        mapOf("runId" to null, "error" to e.message)
      }
    }
    Function("stopRun") { AgentRuntime.stop() }
    Function("resolveGate") { gateId: String, approve: Boolean, text: String? -> AgentRuntime.resolveGate(context, gateId, approve, text) }
    Function("getRun") { AgentRuntime.snapshot() }
    Function("listRuns") { limit: Int -> AgentRuntime.history(context, limit) }
    Function("getRunLog") { runId: String -> AgentRuntime.readRun(context, runId) }
    Function("clearHistory") { AgentRuntime.clearHistory(context) }

    AsyncFunction("listApps") { OwnerStore.apps(context) }
    AsyncFunction("setAppTrust") { pkg: String, level: String, typed: String? -> OwnerStore.setTrust(context, pkg, level, typed) }

    Function("getSettings") { OwnerStore.settings(context).toMap(System.currentTimeMillis()) }
    Function("knownModels") {
      expo.modules.deputyagent.core.Settings.KNOWN.map {
        mapOf(
          "name" to it.name, "baseUrl" to it.baseUrl, "model" to it.model, "images" to it.images,
          "inputPerM" to it.prices.inputPerM, "cachedPerM" to it.prices.cachedPerM, "outputPerM" to it.prices.outputPerM,
        )
      }
    }
    Function("setSettings") { input: Map<String, Any?> -> OwnerStore.saveSettings(context, input) }

    Function("listSavedTasks") { OwnerStore.tasks(context).map(OwnerStore::toMap) }
    Function("saveTask") { input: Map<String, Any?> -> OwnerStore.saveTask(context, input) }
    Function("deleteTask") { id: String -> OwnerStore.deleteTask(context, id) }

    Function("setApiKey") { key: String -> KeyVault.save(context, key, OwnerStore.settings(context).baseUrl) }
    Function("clearApiKey") { KeyVault.clear(context) }
    AsyncFunction("testProvider") Coroutine { -> AgentRuntime.testProvider(context) }

    Function("setPalette") { json: String -> StopChip.setPalette(json) }

    // The system speech dialog records the audio itself, so Deputy needs no microphone permission.
    AsyncFunction("listen") { prompt: String, promise: Promise ->
      pendingSpeech?.resolve(null)
      pendingSpeech = promise
      val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        .putExtra(RecognizerIntent.EXTRA_PROMPT, prompt)
      try {
        appContext.throwingActivity.startActivityForResult(intent, SPEECH_REQUEST)
      } catch (e: ActivityNotFoundException) {
        pendingSpeech = null
        promise.reject("ERR_NO_SPEECH", "This phone has no speech recognizer. Install or turn on the Google app, then try again.", e)
      }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, result ->
      if (result.requestCode != SPEECH_REQUEST) return@OnActivityResult
      val text = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
      pendingSpeech?.resolve(if (result.resultCode == Activity.RESULT_OK) text else null)
      pendingSpeech = null
    }

    AsyncFunction("dumpForegroundTree") Coroutine { delaySeconds: Int ->
      delay(delaySeconds.coerceIn(0, 30) * 1000L)
      val service = DeputyAccessibilityService.instance
      val r = service?.let { withContext(Dispatchers.Default) { it.dumpForeground() } }
      mapOf(
        "pkg" to r?.pkg,
        "nodes" to (r?.nodes ?: 0),
        "text" to (r?.text ?: NOT_CONNECTED),
      )
    }

    Function("copyToClipboard") { text: String ->
      // Screen text can hold codes and messages: keep it out of the clipboard preview and keyboard history.
      val clip = ClipData.newPlainText("Deputy", text)
      clip.description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
      context.getSystemService(ClipboardManager::class.java).setPrimaryClip(clip)
    }
  }
}
