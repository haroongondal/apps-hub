package expo.modules.netlenscore

import android.content.Context
import java.net.Inet4Address
import java.net.InetAddress
import org.json.JSONArray
import org.json.JSONObject

// One process-wide lock: the module, both workers, the "This is mine" receiver and the share provider read and write it.
object HomeWatchStore {
  private const val PREFS = "homenet_home_watch"
  private const val KEY = "state"
  private const val HEARTBEAT = "heartbeatAt"
  private const val LAST_PING = "lastPingAt"
  private const val MAX_PEOPLE = 16
  private const val MAX_IPS_PER_PERSON = 4
  private const val MAX_KNOWN = 512
  private val lock = Any()

  fun load(context: Context): HomeWatchState = synchronized(lock) {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
    runCatching { raw?.let { fromJson(JSONObject(it)) } }.getOrNull() ?: HomeWatchState()
  }

  fun update(context: Context, change: (HomeWatchState) -> HomeWatchState): HomeWatchState = synchronized(lock) {
    val next = change(load(context))
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, toJson(next).toString()).commit()
    next
  }

  /** The health row's last_seen_at: written when the app opens or a background check runs, never by a share query. */
  fun heartbeat(context: Context, now: Long = System.currentTimeMillis()) = synchronized(lock) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong(HEARTBEAT, now).commit()
  }

  fun lastSeenAt(context: Context): Long? = synchronized(lock) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(HEARTBEAT, 0L).takeIf { it > 0L }
  }

  /** True when a CHANGED ping is due (ChangedPing.due), and records it as sent. */
  fun claimPing(context: Context, newDevice: Boolean, presenceChanged: Boolean, now: Long = System.currentTimeMillis()): Boolean =
    synchronized(lock) {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val due = ChangedPing.due(load(context).settings, newDevice, presenceChanged, prefs.getLong(LAST_PING, 0L), now)
      if (due) prefs.edit().putLong(LAST_PING, now).commit()
      due
    }

  /** Applies settings and a device-list snapshot sent by the app; values from JS are checked, not trusted. */
  fun applyFromApp(prev: HomeWatchState, settings: Map<String, Any?>, snapshot: Map<String, Any?>?): HomeWatchState {
    val home = (settings["home"] as? Map<*, *>)?.let { h ->
      val id = h["networkId"] as? String
      val gw = (h["gatewayIp"] as? String)?.takeIf(::isPrivateIpv4)
      val routerId = h["routerId"] as? String
      val routerUrl = (h["routerUrl"] as? String)?.trim()
      // No router ID, or a description URL off the gateway: no home, so nothing runs (fail closed).
      if (id.isNullOrBlank() || gw == null || !HomeRouter.validId(routerId) || routerUrl == null || HomeRouter.target(routerUrl, gw) == null) null
      else HomeNetwork(id, gw, (h["label"] as? String).orEmpty().take(64), routerId!!, routerUrl)
    }
    val hours = (settings["newDeviceHours"] as? Number)?.toInt()
    val nextSettings = HomeSettings(
      whoIsHome = settings["whoIsHome"] == true,
      newDevices = settings["newDevices"] == true,
      newDeviceHours = hours?.takeIf { it in HomeSettings.NEW_DEVICE_HOURS } ?: HomeSettings.DEFAULT_NEW_DEVICE_HOURS,
      share = settings["share"] == true,
      home = home,
    )
    val homeChanged = nextSettings.home?.networkId != prev.settings.home?.networkId
    val base = if (homeChanged) HomeWatchState(settings = nextSettings) else prev.copy(settings = nextSettings)
    if (snapshot == null || nextSettings.home == null) return base
    val byLabel = base.people.associateBy { it.label.lowercase() }
    val people = maps(snapshot["people"]).mapNotNull { p ->
      val label = (p["label"] as? String)?.trim()?.take(64)?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
      val ips = (p["ips"] as? List<*>).orEmpty().filterIsInstance<String>().filter(::isPrivateIpv4).distinct().take(MAX_IPS_PER_PERSON)
      val lastSeenAt = (p["lastSeenAt"] as? Number)?.toLong() ?: 0L
      PersonWatch(label, ips, Presence.merge(byLabel[label.lowercase()]?.state, p["seenNow"] == true, lastSeenAt))
    }.distinctBy { it.label.lowercase() }.take(MAX_PEOPLE)
    val known = maps(snapshot["known"]).mapNotNull { k ->
      val ip = (k["ip"] as? String)?.takeIf(::isPrivateIpv4) ?: return@mapNotNull null
      NewDevices.Known(ip, (k["lastSeenAt"] as? Number)?.toLong() ?: 0L, k["tagged"] == true)
    }.distinctBy { it.ip }.take(MAX_KNOWN)
    return base.copy(people = people, known = known)
  }

  fun status(state: HomeWatchState): Map<String, Any?> = mapOf(
    "supported" to true,
    "settings" to mapOf(
      "whoIsHome" to state.settings.whoIsHome,
      "newDevices" to state.settings.newDevices,
      "newDeviceHours" to state.settings.newDeviceHours,
      "share" to state.settings.share,
      "home" to state.settings.home?.let {
        mapOf("networkId" to it.networkId, "gatewayIp" to it.gatewayIp, "label" to it.label, "routerId" to it.routerId, "routerUrl" to it.routerUrl)
      },
    ),
    "people" to state.people.map { mapOf("label" to it.label, "present" to it.state.present, "lastSeenAt" to it.state.lastSeenAt) },
    "newDevices" to state.alerts.map {
      mapOf("ip" to it.ip, "firstSeenAt" to it.firstSeenAt, "label" to it.label, "acknowledged" to it.acknowledged)
    },
  )

  fun isPrivateIpv4(ip: String): Boolean {
    if (!Regex("""^\d{1,3}(\.\d{1,3}){3}$""").matches(ip)) return false
    val addr = runCatching { InetAddress.getByName(ip) }.getOrNull() as? Inet4Address ?: return false
    return addr.isSiteLocalAddress || addr.isLinkLocalAddress
  }

  private fun maps(v: Any?): List<Map<*, *>> = (v as? List<*>).orEmpty().filterIsInstance<Map<*, *>>()

  private fun toJson(s: HomeWatchState): JSONObject = JSONObject()
    .put("settings", JSONObject()
      .put("whoIsHome", s.settings.whoIsHome)
      .put("newDevices", s.settings.newDevices)
      .put("newDeviceHours", s.settings.newDeviceHours)
      .put("share", s.settings.share)
      .put("home", s.settings.home?.let {
        JSONObject().put("networkId", it.networkId).put("gatewayIp", it.gatewayIp).put("label", it.label)
          .put("routerId", it.routerId).put("routerUrl", it.routerUrl)
      } ?: JSONObject.NULL))
    .put("people", JSONArray(s.people.map {
      JSONObject().put("label", it.label).put("ips", JSONArray(it.ips))
        .put("present", it.state.present).put("misses", it.state.misses).put("lastSeenAt", it.state.lastSeenAt)
    }))
    .put("known", JSONArray(s.known.map { JSONObject().put("ip", it.ip).put("lastSeenAt", it.lastSeenAt).put("tagged", it.tagged) }))
    .put("alerts", JSONArray(s.alerts.map {
      JSONObject().put("ip", it.ip).put("firstSeenAt", it.firstSeenAt).put("label", it.label).put("acknowledged", it.acknowledged)
    }))

  private fun objects(a: JSONArray?): List<JSONObject> = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }

  private fun fromJson(o: JSONObject): HomeWatchState {
    val s = o.optJSONObject("settings") ?: JSONObject()
    val h = s.optJSONObject("home")
    return HomeWatchState(
      settings = HomeSettings(
        whoIsHome = s.optBoolean("whoIsHome"),
        newDevices = s.optBoolean("newDevices"),
        newDeviceHours = s.optInt("newDeviceHours", HomeSettings.DEFAULT_NEW_DEVICE_HOURS),
        share = s.optBoolean("share"),
        home = h?.let {
          HomeNetwork(it.optString("networkId"), it.optString("gatewayIp"), it.optString("label"), it.optString("routerId"), it.optString("routerUrl"))
        },
      ),
      people = objects(o.optJSONArray("people")).map { p ->
        val ips = p.optJSONArray("ips")
        PersonWatch(
          p.optString("label"),
          if (ips == null) emptyList() else (0 until ips.length()).map { ips.optString(it) },
          Presence.State(p.optBoolean("present"), p.optInt("misses"), p.optLong("lastSeenAt")),
        )
      },
      known = objects(o.optJSONArray("known")).map { NewDevices.Known(it.optString("ip"), it.optLong("lastSeenAt"), it.optBoolean("tagged")) },
      alerts = objects(o.optJSONArray("alerts")).map {
        NewDevices.Alert(it.optString("ip"), it.optLong("firstSeenAt"), it.optString("label"), it.optBoolean("acknowledged"))
      },
    )
  }
}
