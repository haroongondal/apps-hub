package expo.modules.placereminders

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.placereminders.android.CurrentPlace
import expo.modules.placereminders.android.PermissionDenied
import expo.modules.placereminders.android.PlaceAlerts

class PlaceRemindersModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PlaceReminders")

    AsyncFunction("setReminders") { json: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("alert_failed", "The app isn't running", null)
        return@AsyncFunction
      }
      try {
        PlaceAlerts.replace(context, json)
        promise.resolve(null)
      } catch (e: PermissionDenied) {
        promise.reject("permission_denied", e.message, e)
      } catch (e: Exception) {
        promise.reject("alert_failed", e.message ?: "Could not register the place reminders", e)
      }
    }

    AsyncFunction("currentPlace") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("no_fix", "The app isn't running", null)
        return@AsyncFunction
      }
      CurrentPlace.get(context, promise)
    }
  }
}
