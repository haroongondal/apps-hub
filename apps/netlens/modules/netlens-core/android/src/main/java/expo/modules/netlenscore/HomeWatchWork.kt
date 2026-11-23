package expo.modules.netlenscore

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.net.Inet4Address
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

class WhoIsHomeWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    HomeWatch.checkWhoIsHome(applicationContext)
    return Result.success()
  }
}

class NewDeviceWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    HomeWatch.checkNewDevices(applicationContext)
    return Result.success()
  }
}

/** "This is mine" on a new-device notification: the device counts as known from now on. */
class ThisIsMineReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val ip = intent.getStringExtra(HomeWatch.EXTRA_IP) ?: return
    HomeWatchStore.update(context) { it.copy(alerts = NewDevices.acknowledge(it.alerts, ip)) }
    (context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager)?.cancel(HomeWatch.notificationId(ip))
  }
}

object HomeWatch {
  const val EXTRA_IP = "expo.modules.netlenscore.extra.IP"
  private const val WHO_IS_HOME_WORK = "homenet-who-is-home"
  private const val NEW_DEVICE_WORK = "homenet-new-devices"
  private const val CHANNEL = "homenet-new-devices"
  private const val DEVICES_URL = "netlens://devices"
  private const val TIMEOUT_MS = 350
  private const val MAX_NOTIFICATIONS = 5

  data class HomeLan(val network: Network, val localIp: String)

  fun schedule(context: Context, settings: HomeSettings) {
    val work = WorkManager.getInstance(context)
    val constraints = Constraints.Builder()
      .setRequiredNetworkType(NetworkType.CONNECTED)
      .setRequiresBatteryNotLow(true)
      .build()
    if (settings.whoIsHome && settings.home != null) {
      work.enqueueUniquePeriodicWork(
        WHO_IS_HOME_WORK,
        ExistingPeriodicWorkPolicy.UPDATE,
        PeriodicWorkRequest.Builder(WhoIsHomeWorker::class.java, 15, TimeUnit.MINUTES).setConstraints(constraints).build(),
      )
    } else {
      work.cancelUniqueWork(WHO_IS_HOME_WORK)
    }
    if (settings.newDevices && settings.home != null) {
      work.enqueueUniquePeriodicWork(
        NEW_DEVICE_WORK,
        ExistingPeriodicWorkPolicy.UPDATE,
        PeriodicWorkRequest.Builder(NewDeviceWorker::class.java, settings.newDeviceHours.toLong(), TimeUnit.HOURS)
          .setConstraints(constraints).build(),
      )
    } else {
      work.cancelUniqueWork(NEW_DEVICE_WORK)
    }
  }

  /** The Wi-Fi network whose default gateway is the saved home gateway; null on mobile data or any other Wi-Fi. */
  @Suppress("DEPRECATION") // allNetworks: a one-shot lookup from a worker, same as PlatformNetwork.lanNetwork
  fun homeLan(context: Context, gatewayIp: String): HomeLan? {
    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return null
    for (network in cm.allNetworks) {
      val caps = cm.getNetworkCapabilities(network) ?: continue
      if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue
      val link = cm.getLinkProperties(network) ?: continue
      val gateway = link.routes.firstOrNull { it.isDefaultRoute && it.gateway is Inet4Address }?.gateway?.hostAddress
      val localIp = link.linkAddresses.map { it.address }.firstOrNull { it is Inet4Address && !it.isLoopbackAddress }?.hostAddress
      if (gateway == gatewayIp && localIp != null) return HomeLan(network, localIp)
    }
    return null
  }

  private suspend fun sweep(lan: HomeLan, ips: List<String>): Map<String, DiscoveredHostPayload> {
    val alive = ConcurrentHashMap<String, DiscoveredHostPayload>()
    TcpSweepEngine(
      hostIps = ips,
      ports = TcpProbe.DEFAULT_PORTS,
      timeoutMs = TIMEOUT_MS,
      newSocket = { lan.network.socketFactory.createSocket() },
    ) { host -> alive[host.ip] = host }.run()
    return alive
  }

  suspend fun checkWhoIsHome(context: Context) {
    val state = HomeWatchStore.load(context)
    val home = state.settings.home ?: return
    if (!state.settings.whoIsHome) return
    val lan = homeLan(context, home.gatewayIp) ?: return
    val ips = state.people.flatMap { it.ips }.filter { HomeSubnet.sameSlash24(it, lan.localIp) }.distinct()
    val alive = sweep(lan, ips)
    val now = System.currentTimeMillis()
    HomeWatchStore.update(context) { s ->
      if (s.settings.home?.networkId != home.networkId) s
      else s.copy(people = s.people.map { p -> p.copy(state = Presence.next(p.state, p.ips.any { it in alive }, now)) })
    }
  }

  suspend fun checkNewDevices(context: Context) {
    val state = HomeWatchStore.load(context)
    val home = state.settings.home ?: return
    if (!state.settings.newDevices) return
    val lan = homeLan(context, home.gatewayIp) ?: return
    val alive = sweep(lan, HomeSubnet.sweepHosts(lan.localIp))
    val now = System.currentTimeMillis()
    val ordered = HomeSubnet.sweepHosts(lan.localIp).mapNotNull { alive[it] }.map { NewDevices.Alive(it.ip, it.winningPort) }
    var fresh: List<NewDevices.Alert> = emptyList()
    HomeWatchStore.update(context) { s ->
      if (s.settings.home?.networkId != home.networkId || !s.settings.newDevices) return@update s
      fresh = NewDevices.find(ordered, s.known, s.alerts, lan.localIp, home.gatewayIp, now)
        .map { NewDevices.Alert(it.ip, now, NewDevices.guess(it.port), acknowledged = false) }
      s.copy(alerts = NewDevices.record(s.alerts, fresh, now), known = NewDevices.refreshKnown(s.known, alive.keys, now))
    }
    fresh.take(MAX_NOTIFICATIONS).forEach { notifyNewDevice(context, it, home.label) }
  }

  fun notificationId(ip: String): Int = 0x4e440000 or (ip.hashCode() and 0xffff)

  private fun notifyNewDevice(context: Context, alert: NewDevices.Alert, networkLabel: String) {
    if (Build.VERSION.SDK_INT >= 33 &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) return
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
    val builder = if (Build.VERSION.SDK_INT >= 26) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "New devices on your Wi-Fi", NotificationManager.IMPORTANCE_DEFAULT))
      Notification.Builder(context, CHANNEL)
    } else {
      @Suppress("DEPRECATION") Notification.Builder(context)
    }
    val id = notificationId(alert.ip)
    val open = PendingIntent.getActivity(
      context,
      id,
      Intent(Intent.ACTION_VIEW, Uri.parse(DEVICES_URL)).setPackage(context.packageName),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val mine = PendingIntent.getBroadcast(
      context,
      id,
      Intent(context, ThisIsMineReceiver::class.java).putExtra(EXTRA_IP, alert.ip),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val where = networkLabel.ifBlank { "your Wi-Fi" }
    val notification = builder
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setContentTitle("A new device joined $where")
      .setContentText("${alert.label} at ${alert.ip}. Tap to see your devices.")
      .setAutoCancel(true)
      .setContentIntent(open)
      .addAction(Notification.Action.Builder(Icon.createWithResource(context, android.R.drawable.ic_dialog_info), "This is mine", mine).build())
      .build()
    nm.notify(id, notification)
  }
}
