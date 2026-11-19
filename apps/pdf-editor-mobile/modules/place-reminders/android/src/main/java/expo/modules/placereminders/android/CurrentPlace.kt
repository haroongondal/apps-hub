package expo.modules.placereminders.android

import android.annotation.SuppressLint
import android.annotation.TargetApi
import android.content.Context
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import java.util.concurrent.Executor

/** One fix for "use my current location": the last known one if it is fresh, else a new one (20 s at most). */
object CurrentPlace {
  private const val FRESH_MS = 120_000L
  private const val TIMEOUT_MS = 20_000L
  private const val NO_FIX = "No location yet. Try again somewhere with a clear view of the sky."

  @SuppressLint("MissingPermission")
  fun get(context: Context, promise: Promise) {
    if (!PlaceAlerts.hasFineLocation(context)) {
      promise.reject("permission_denied", "Allow precise location for Nexus in Settings to use your location", null)
      return
    }
    val manager = context.getSystemService(LocationManager::class.java)
    val provider = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).firstOrNull { manager.isProviderEnabled(it) }
    if (provider == null) {
      promise.reject("location_off", "Location is turned off. Turn it on in the phone's settings.", null)
      return
    }
    val last = manager.getLastKnownLocation(provider)
    if (last != null && System.currentTimeMillis() - last.time < FRESH_MS) {
      promise.resolve(fix(last))
      return
    }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      if (last != null) promise.resolve(fix(last)) else promise.reject("no_fix", NO_FIX, null)
      return
    }
    freshFix(context, manager, provider, promise)
  }

  @TargetApi(Build.VERSION_CODES.R)
  private fun freshFix(context: Context, manager: LocationManager, provider: String, promise: Promise) {
    val handler = Handler(Looper.getMainLooper())
    val cancel = CancellationSignal()
    var done = false
    fun finish(settle: () -> Unit) {
      if (done) return
      done = true
      settle()
    }
    handler.postDelayed({
      finish {
        cancel.cancel()
        promise.reject("no_fix", NO_FIX, null)
      }
    }, TIMEOUT_MS)
    val executor = Executor { handler.post(it) }
    manager.getCurrentLocation(provider, cancel, executor) { loc: Location? ->
      finish {
        handler.removeCallbacksAndMessages(null)
        if (loc != null) promise.resolve(fix(loc)) else promise.reject("no_fix", NO_FIX, null)
      }
    }
  }

  private fun fix(loc: Location): Map<String, Any> =
    mapOf("lat" to loc.latitude, "lng" to loc.longitude, "accuracyM" to loc.accuracy.toDouble())
}
