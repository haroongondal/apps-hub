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
import expo.modules.deputyagent.android.DeputyAccessibilityService
import expo.modules.deputyagent.android.SpikeProbes
import expo.modules.deputyagent.core.ServiceSetting
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

private const val NOT_CONNECTED =
  "The accessibility service isn't connected. If Setup says it is on, turn it off and on again in Accessibility settings."

class DeputyAgentModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  private fun open(intent: Intent) = context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))

  override fun definition() = ModuleDefinition {
    Name("DeputyAgent")

    Function("getServiceState") {
      val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
      mapOf(
        "accessibilityEnabled" to ServiceSetting.isEnabled(enabled, context.packageName, DeputyAccessibilityService::class.java.name),
        "notificationsAllowed" to context.getSystemService(NotificationManager::class.java).areNotificationsEnabled(),
        "batteryUnrestricted" to context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName),
      )
    }

    Function("openAccessibilitySettings") { open(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }

    Function("openAppInfo") {
      open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
    }

    Function("openBatterySettings") { open(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }

    Function("disableService") { DeputyAccessibilityService.instance?.let { it.disableSelf(); true } ?: false }

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

    Function("armForegroundProbe") { SpikeProbes.arm() }
    Function("getSpikeReport") { SpikeProbes.report() }
    Function("clearSpikeReport") { SpikeProbes.clear() }

    AsyncFunction("probeScreenshots") Coroutine { delaySeconds: Int ->
      delay(delaySeconds.coerceIn(0, 30) * 1000L)
      DeputyAccessibilityService.instance?.let { SpikeProbes.screenshots(it) } ?: NOT_CONNECTED
    }

    AsyncFunction("probeTyping") Coroutine { delaySeconds: Int ->
      delay(delaySeconds.coerceIn(0, 30) * 1000L)
      DeputyAccessibilityService.instance?.let { SpikeProbes.typing(it) } ?: NOT_CONNECTED
    }

    Function("copyToClipboard") { text: String ->
      // Screen text can hold codes and messages: keep it out of the clipboard preview and keyboard history.
      val clip = ClipData.newPlainText("Deputy", text)
      clip.description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
      context.getSystemService(ClipboardManager::class.java).setPrimaryClip(clip)
    }
  }
}
