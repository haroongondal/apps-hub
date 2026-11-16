package expo.modules.haloengine

import android.Manifest
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import expo.modules.haloengine.android.HaloListener
import expo.modules.haloengine.android.HaloService
import expo.modules.haloengine.android.ProbeLog
import expo.modules.haloengine.android.SettingsStore
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val STATUS_EVENT = "onStatus"

class HaloEngineModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  private fun open(intent: Intent) = context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))

  private fun status(): Map<String, Any?> = mapOf(
    "running" to HaloService.running,
    "overlayAllowed" to Settings.canDrawOverlays(context),
    "listenerAllowed" to context.getSystemService(NotificationManager::class.java)
      .isNotificationListenerAccessGranted(ComponentName(context, HaloListener::class.java)),
    "audioAllowed" to (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED),
    "notificationsAllowed" to context.getSystemService(NotificationManager::class.java).areNotificationsEnabled(),
    "audio" to HaloService.audio,
    "playingApp" to null,
    "frameP95Ms" to null,
  )

  override fun definition() = ModuleDefinition {
    Name("HaloEngine")

    Events(STATUS_EVENT)

    OnCreate { HaloService.onChange = { sendEvent(STATUS_EVENT, status()) } }

    // The service outlives React on purpose (it is the product); only the event hook is dropped.
    OnDestroy { HaloService.onChange = null }

    Function("start") { HaloService.start(context, HaloService.MEDIA_PLAYBACK, "button") }

    Function("stop") { HaloService.stop(context) }

    Function("getStatus") { status() }

    Function("openPermission") { kind: String ->
      open(
        when (kind) {
          "overlay" -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
          "listener" -> Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
          "battery" -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
          "appDetails" -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
          else -> throw IllegalArgumentException("Unknown permission kind: $kind")
        },
      )
    }

    Function("probeLog") { ProbeLog.read(context) }

    Function("clearProbeLog") { ProbeLog.clear(context) }

    Function("getSettings") { SettingsStore.read(context) }

    Function("setSettings") { json: String -> SettingsStore.write(context, json) }
  }
}
