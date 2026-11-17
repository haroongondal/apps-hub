package expo.modules.haloengine

import android.Manifest
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import expo.modules.haloengine.android.AppIcons
import expo.modules.haloengine.android.HaloListener
import expo.modules.haloengine.android.HaloService
import expo.modules.haloengine.android.NotifyFlash
import expo.modules.haloengine.android.ProbeLog
import expo.modules.haloengine.android.RuleInputs
import expo.modules.haloengine.android.SettingsStore
import expo.modules.haloengine.core.Patterns
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
    "batteryUnrestricted" to context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName),
    "usageAllowed" to RuleInputs.usageAllowed(context),
    "audio" to HaloService.audio,
    "playingApp" to HaloService.playingApp,
    "frameP95Ms" to HaloService.frameP95Ms,
  )

  override fun definition() = ModuleDefinition {
    Name("HaloEngine")

    Events(STATUS_EVENT)

    OnCreate { HaloService.onChange = { sendEvent(STATUS_EVENT, status()) } }

    // The service outlives React on purpose (it is the product); only the event hook is dropped.
    OnDestroy { HaloService.onChange = null }

    Function("start") { HaloService.start(context, HaloService.MEDIA_PLAYBACK, "button") }

    Function("stop") { HaloService.stop(context) }

    // The app calls this when it comes to the front, which is when overlay access may have just been granted.
    Function("getStatus") {
      HaloService.retryWindow()
      status()
    }

    Function("openPermission") { kind: String ->
      open(
        when (kind) {
          "overlay" -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
          "listener" -> Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
          "battery" -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
          "appDetails" -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
          "usage" -> Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
          else -> throw IllegalArgumentException("Unknown permission kind: $kind")
        },
      )
    }

    Function("probeLog") { ProbeLog.read(context) }

    Function("clearProbeLog") { ProbeLog.clear(context) }

    Function("getSettings") { SettingsStore.read(context) }

    Function("setSettings") { json: String -> SettingsStore.write(context, json) }

    Function("setPreview") { on: Boolean -> HaloService.setPreview(context, on) }

    Function("getAodSpike") { SettingsStore.aodSpike(context) }

    Function("setAodSpike") { on: Boolean -> SettingsStore.setAodSpike(context, on) }

    // Launchable apps for the per-app lists: apps that have notified first, then by label.
    AsyncFunction("listApps") {
      val pm = context.packageManager
      val notified = NotifyFlash.notified(context)
      val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      pm.queryIntentActivities(launcher, PackageManager.ResolveInfoFlags.of(0))
        .distinctBy { it.activityInfo.packageName }
        .filter { it.activityInfo.packageName != context.packageName }
        .map { Triple(it.activityInfo.packageName, it.activityInfo.applicationInfo.loadLabel(pm).toString(), it.activityInfo.packageName in notified) }
        .sortedWith(compareBy({ !it.third }, { it.second.lowercase() }))
        .map { (pkg, label, n) -> mapOf("pkg" to pkg, "label" to label, "notified" to n) }
    }

    AsyncFunction("appIconUri") { pkg: String -> AppIcons.iconUri(context, pkg) }

    // Names are the ids in plain words ("pulse-ring" -> "Pulse ring"), so the app never hard-codes ids.
    Function("listPatterns") {
      Patterns.all.map { make ->
        val p = make()
        mapOf("id" to p.id, "family" to p.family.name.lowercase(), "name" to p.id.replace('-', ' ').replaceFirstChar { it.uppercase() })
      }
    }
  }
}
