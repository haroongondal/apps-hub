package expo.modules.inflowcore

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.inflowcore.android.Lock
import expo.modules.inflowcore.android.InflowListener
import expo.modules.inflowcore.android.SqlItemStore
import expo.modules.inflowcore.android.StoreHolder
import expo.modules.inflowcore.core.AppSetting
import expo.modules.inflowcore.core.Retention

private const val CAPTURED_EVENT = "onCaptured"

class InflowCoreModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  private fun store(): SqlItemStore =
    StoreHolder.get(context).getOrElse { throw CodedException("STORE_UNAVAILABLE", it.message, it) }

  private fun open(intent: Intent) {
    context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  private fun settingFor(store: SqlItemStore, pkg: String): AppSetting = store.appSetting(pkg) ?: Retention.default(pkg, InflowListener.label(context, pkg))

  override fun definition() = ModuleDefinition {
    Name("InflowCore")

    Events(CAPTURED_EVENT)

    OnCreate {
      StoreHolder.onCaptured = { count -> sendEvent(CAPTURED_EVENT, mapOf("count" to count)) }
    }

    OnDestroy {
      StoreHolder.onCaptured = null
    }

    Function("getStatus") { ->
      val ctx = context
      val holder = StoreHolder.get(ctx)
      mapOf(
        "accessGranted" to NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.packageName),
        "listenerConnected" to InflowListener.connected.get(),
        "lastCaptureAt" to holder.getOrNull()?.meta(InflowListener.LAST_CAPTURE_AT)?.toLongOrNull(),
        "batteryUnrestricted" to (ctx.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(ctx.packageName) ?: false),
        "storeError" to holder.exceptionOrNull()?.message,
      )
    }

    Function("openNotificationAccess") { ->
      open(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
    }

    Function("openAppInfo") { ->
      open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)))
    }

    Function("openBatterySettings") { ->
      open(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
    }

    Function("reconnect") { ->
      InflowListener.rebind(context)
    }

    AsyncFunction("authenticate") Coroutine { ->
      val activity = appContext.currentActivity as? FragmentActivity
      val (ok, message) = if (activity == null) false to Lock.FAILED else Lock.authenticate(activity)
      mapOf("ok" to ok, "message" to message)
    }

    Function("home") { startOfDay: Long ->
      val store = store()
      StoreHolder.ingest(context, store).housekeeping()
      store.home(startOfDay, System.currentTimeMillis())
    }

    Function("listItems") { filter: Map<String, Any?>, before: Long?, limit: Int, beforeId: Long? ->
      store().list(filter, before, limit, System.currentTimeMillis(), beforeId)
    }

    Function("listApps") { ->
      store().allAppSettings().map { mapOf("pkg" to it.pkg, "label" to it.label, "record" to it.record, "keepDays" to it.keepDays) }
    }

    Function("setRecord") { pkg: String, record: Boolean, deleteSaved: Boolean ->
      val store = store()
      store.putAppSetting(settingFor(store, pkg).copy(record = record))
      if (deleteSaved) store.deleteApp(pkg)
    }

    Function("setKeep") { pkg: String, days: Int? ->
      val store = store()
      store.putAppSetting(settingFor(store, pkg).copy(keepDays = days))
    }

    Function("renameSender") { senderKey: String, name: String? ->
      store().rename(senderKey, name)
    }

    Function("listSenderNames") { ->
      store().senderNames()
    }
  }
}
