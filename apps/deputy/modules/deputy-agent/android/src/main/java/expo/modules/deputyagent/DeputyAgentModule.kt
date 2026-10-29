package expo.modules.deputyagent

import android.app.NotificationManager
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PersistableBundle
import android.os.PowerManager
import android.provider.Settings
import expo.modules.deputyagent.android.AgentRuntime
import expo.modules.deputyagent.android.DeputyAccessibilityService
import expo.modules.deputyagent.android.KeyVault
import expo.modules.deputyagent.android.StopChip
import expo.modules.deputyagent.core.ServiceSetting
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

private const val NOT_CONNECTED =
  "The accessibility service isn't connected. If Setup says it is on, turn it off and on again in Accessibility settings."
private const val RUN_EVENT = "onRunEvent"

class DeputyAgentModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

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
        "keySet" to KeyVault.has(context),
        "runActive" to AgentRuntime.active,
      )
    }

    Function("openAccessibilitySettings") { open(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }

    Function("openAppInfo") {
      open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
    }

    Function("openBatterySettings") { open(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }

    Function("disableService") { DeputyAccessibilityService.instance?.let { it.disableSelf(); true } ?: false }

    Function("startRun") { task: String ->
      try {
        mapOf("runId" to AgentRuntime.start(context, task), "error" to null)
      } catch (e: IllegalStateException) {
        mapOf("runId" to null, "error" to e.message)
      }
    }
    Function("stopRun") { AgentRuntime.stop() }
    Function("resolveGate") { gateId: String, approve: Boolean, text: String? -> AgentRuntime.resolveGate(context, gateId, approve, text) }
    Function("getRun") { AgentRuntime.snapshot() }

    Function("setApiKey") { key: String -> KeyVault.save(context, key) }
    Function("clearApiKey") { KeyVault.clear(context) }
    AsyncFunction("testProvider") Coroutine { -> AgentRuntime.testProvider(context) }

    Function("setPalette") { json: String -> StopChip.setPalette(json) }

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
