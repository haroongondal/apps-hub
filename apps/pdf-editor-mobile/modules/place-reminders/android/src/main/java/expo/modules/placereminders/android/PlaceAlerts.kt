package expo.modules.placereminders.android

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
import android.util.Log
import expo.modules.placereminders.core.PlaceReminder
import expo.modules.placereminders.core.radiusFor
import org.json.JSONArray
import java.io.File

class PermissionDenied : Exception("Allow precise location for Nexus in Settings, so reminders can find the place")

internal const val EXTRA_ITEM_ID = "placeReminder.itemId"
internal const val EXTRA_TITLE = "placeReminder.title"
internal const val EXTRA_TRIGGER = "placeReminder.trigger"

object PlaceAlerts {
  private const val STORE = "place-reminders.json"

  fun hasFineLocation(context: Context): Boolean =
    context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

  @SuppressLint("MissingPermission")
  fun replace(context: Context, json: String) {
    val next = parse(json)
    if (next.isNotEmpty() && !hasFineLocation(context)) throw PermissionDenied()
    val manager = manager(context)
    for (old in saved(context)) manager.removeProximityAlert(pendingFor(context, old))
    for (r in next) manager.addProximityAlert(r.lat, r.lng, radiusFor(r.radiusM), -1L, pendingFor(context, r))
    store(context).writeText(json)
  }

  @SuppressLint("MissingPermission")
  fun restore(context: Context) {
    if (!hasFineLocation(context)) return
    try {
      val manager = manager(context)
      for (r in saved(context)) manager.addProximityAlert(r.lat, r.lng, radiusFor(r.radiusM), -1L, pendingFor(context, r))
    } catch (e: Exception) {
      Log.w("PlaceReminders", "Could not restore the place reminders", e)
    }
  }

  private fun saved(context: Context): List<PlaceReminder> =
    store(context).takeIf { it.exists() }?.let { parse(it.readText()) } ?: emptyList()

  fun parse(json: String): List<PlaceReminder> {
    val array = JSONArray(json)
    return (0 until array.length()).map { i ->
      val o = array.getJSONObject(i)
      PlaceReminder(
        id = o.getString("id"),
        itemId = o.getString("itemId"),
        title = o.getString("title"),
        lat = o.getDouble("lat"),
        lng = o.getDouble("lng"),
        radiusM = o.getInt("radiusM"),
        trigger = o.getString("trigger"),
      )
    }
  }

  // The system adds the entering flag to this intent, so the PendingIntent must be mutable.
  private fun pendingFor(context: Context, r: PlaceReminder): PendingIntent {
    val intent = Intent(context, PlaceReminderReceiver::class.java)
      .setData(Uri.parse("placereminder:${r.id}"))
      .putExtra(EXTRA_ITEM_ID, r.itemId)
      .putExtra(EXTRA_TITLE, r.title)
      .putExtra(EXTRA_TRIGGER, r.trigger)
    return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
  }

  private fun store(context: Context) = File(context.filesDir, STORE)

  private fun manager(context: Context): LocationManager = context.getSystemService(LocationManager::class.java)
}
