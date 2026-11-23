package expo.modules.netlenscore

// Pure twins of packages/core presence.ts and new-devices.ts; HomeRulesTest runs the same fixtures.

object Presence {
  const val AWAY_AFTER_MISSES = 3

  data class State(val present: Boolean, val misses: Int, val lastSeenAt: Long)

  val UNKNOWN = State(present = false, misses = AWAY_AFTER_MISSES, lastSeenAt = 0L)

  fun next(prev: State, answered: Boolean, now: Long, awayAfter: Int = AWAY_AFTER_MISSES): State {
    if (answered) return State(present = true, misses = 0, lastSeenAt = maxOf(prev.lastSeenAt, now))
    val misses = prev.misses + 1
    return State(present = prev.present && misses < awayAfter, misses = misses, lastSeenAt = prev.lastSeenAt)
  }

  fun merge(prev: State?, seenNow: Boolean, lastSeenAt: Long): State {
    val base = prev ?: UNKNOWN.copy(lastSeenAt = lastSeenAt)
    return if (seenNow && (prev == null || lastSeenAt > prev.lastSeenAt)) next(base, true, lastSeenAt) else base
  }
}

object NewDevices {
  const val WINDOW_DAYS = 30
  const val MAX_ALERTS = 200
  private const val DAY_MS = 86_400_000L

  data class Alive(val ip: String, val port: Int?)
  data class Known(val ip: String, val lastSeenAt: Long, val tagged: Boolean)
  data class Alert(val ip: String, val firstSeenAt: Long, val label: String, val acknowledged: Boolean)

  fun find(
    alive: List<Alive>,
    known: List<Known>,
    alerts: List<Alert>,
    selfIp: String,
    gatewayIp: String?,
    now: Long,
    windowDays: Int = WINDOW_DAYS,
  ): List<Alive> {
    val since = now - windowDays * DAY_MS
    val skip = mutableSetOf(selfIp)
    if (gatewayIp != null) skip += gatewayIp
    known.filter { it.tagged || it.lastSeenAt >= since }.mapTo(skip) { it.ip }
    alerts.filter { it.acknowledged || it.firstSeenAt >= since }.mapTo(skip) { it.ip }
    return alive.filter { skip.add(it.ip) }
  }

  fun guess(port: Int?): String = when (port) {
    62078 -> "iPhone or iPad"
    445 -> "Computer"
    else -> "Unknown device"
  }

  fun record(alerts: List<Alert>, fresh: List<Alert>, now: Long, windowDays: Int = WINDOW_DAYS): List<Alert> {
    val since = now - windowDays * DAY_MS
    val freshIps = fresh.map { it.ip }.toSet()
    val kept = alerts.filter { (it.acknowledged || it.firstSeenAt >= since) && it.ip !in freshIps }
    return (fresh + kept).sortedByDescending { it.firstSeenAt }.take(MAX_ALERTS)
  }

  fun acknowledge(alerts: List<Alert>, ip: String): List<Alert> =
    alerts.map { if (it.ip == ip) it.copy(acknowledged = true) else it }

  fun refreshKnown(known: List<Known>, aliveIps: Set<String>, now: Long): List<Known> =
    known.map { if (it.ip in aliveIps) it.copy(lastSeenAt = maxOf(it.lastSeenAt, now)) else it }
}

object HomeSubnet {
  private fun octets(ip: String): List<Int>? =
    ip.trim().split('.').takeIf { it.size == 4 }?.map { it.toIntOrNull() ?: return null }?.takeIf { o -> o.all { it in 0..255 } }

  fun sameSlash24(a: String, b: String): Boolean {
    val x = octets(a) ?: return false
    val y = octets(b) ?: return false
    return x.take(3) == y.take(3)
  }

  // The same /24 window as subnet-calculator.ts (network and broadcast excluded, this phone included).
  fun sweepHosts(localIp: String): List<String> {
    val o = octets(localIp) ?: return emptyList()
    return (1..254).map { "${o[0]}.${o[1]}.${o[2]}.$it" }
  }
}

data class HomeNetwork(val networkId: String, val gatewayIp: String, val label: String)

data class HomeSettings(
  val whoIsHome: Boolean = false,
  val newDevices: Boolean = false,
  val newDeviceHours: Int = DEFAULT_NEW_DEVICE_HOURS,
  val share: Boolean = false,
  val home: HomeNetwork? = null,
) {
  companion object {
    val NEW_DEVICE_HOURS = listOf(3, 6, 12, 24)
    const val DEFAULT_NEW_DEVICE_HOURS = 6
  }
}

data class PersonWatch(val label: String, val ips: List<String>, val state: Presence.State)

data class HomeWatchState(
  val settings: HomeSettings = HomeSettings(),
  val people: List<PersonWatch> = emptyList(),
  val known: List<NewDevices.Known> = emptyList(),
  val alerts: List<NewDevices.Alert> = emptyList(),
)

object HomeShareRows {
  const val AUTHORITY = "com.haroon.netlens.applink"
  const val WHO_IS_HOME_PATH = "who_is_home"
  const val NEW_DEVICES_PATH = "new_devices"
  val WHO_IS_HOME_COLUMNS = arrayOf("person", "present", "last_seen_at")
  val NEW_DEVICES_COLUMNS = arrayOf("first_seen_at", "label", "acknowledged")
  const val WHO_IS_HOME_LIMIT = 16
  const val NEW_DEVICES_LIMIT = 200

  fun whoIsHome(state: HomeWatchState): List<Array<Any>> =
    if (!state.settings.share || !state.settings.whoIsHome) emptyList()
    else state.people.take(WHO_IS_HOME_LIMIT).map { arrayOf(it.label, if (it.state.present) 1 else 0, it.state.lastSeenAt) }

  fun newDevices(state: HomeWatchState): List<Array<Any>> =
    if (!state.settings.share || !state.settings.newDevices) emptyList()
    else state.alerts.take(NEW_DEVICES_LIMIT).map { arrayOf(it.firstSeenAt, it.label, if (it.acknowledged) 1 else 0) }
}
