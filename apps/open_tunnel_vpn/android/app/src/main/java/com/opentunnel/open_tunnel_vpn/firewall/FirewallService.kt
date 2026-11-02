package com.opentunnel.open_tunnel_vpn.firewall

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.net.ConnectivityManager
import android.net.IpPrefix
import android.net.NetworkCapabilities
import android.net.Uri
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.annotation.RequiresApi
import com.opentunnel.open_tunnel_vpn.MainActivity
import com.opentunnel.open_tunnel_vpn.R
import expo.modules.opentunnelnative.firewall.FirewallContract
import expo.modules.opentunnelnative.firewall.FirewallStartPolicy
import expo.modules.opentunnelnative.firewall.FirewallStore
import java.net.InetAddress

/**
 * The firewall's VpnService, declared `android:process=":firewall"` because firestack's and
 * WireGuard's Go runtimes crash each other inside one process. It shares nothing in memory with the
 * UI process: rules and the `running` and `paused` state live in [FirewallStore].
 *
 * It never calls the bypass opt-out (AGENTS rule 3). The tun is handed to [FirewallEngine], which is the
 * only code that calls firestack. Android 10 or newer: app attribution (`getConnectionOwnerUid`) starts
 * at API 29, and the UI never starts this on older ones.
 */
@RequiresApi(Build.VERSION_CODES.Q)
class FirewallService : VpnService() {

  private lateinit var store: FirewallStore
  private lateinit var engine: FirewallEngine
  private var tun: ParcelFileDescriptor? = null
  private var paused = false

  override fun onCreate() {
    super.onCreate()
    store = FirewallStore(this)
    engine = FirewallEngine(this, store)
    ensureChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // The 5-second foreground window comes first, whatever the action is.
    startForegroundNow()
    val idle = tun == null && !paused
    // Task 13 reads this line, and the saved action, on the phone to see which action Always-on really sends.
    Log.i(TAG, "onStartCommand action=${intent?.action}")
    runCatching { store.writeState(STATE_LAST_START_ACTION, intent?.action ?: "null") }
      .onFailure { Log.e(TAG, "could not save the start action: ${it.message}") }
    if (startsOn(intent?.action)) {
      // Always-on and boot are implicit starts: they run only while the user's switch is on.
      // A failed read is null, which the policy treats as off: fail closed, never crash the :firewall process.
      if (isImplicitStart(intent?.action) &&
        !FirewallStartPolicy.startOnNullAction(runCatching { store.readState(STATE_ENABLED) }.getOrNull())
      ) {
        Log.i(TAG, "implicit start while the firewall is off: stopping")
        stop()
      } else {
        start()
      }
      return START_NOT_STICKY
    }
    when (intent?.action) {
      ACTION_STOP -> stop()
      ACTION_PAUSE -> if (idle) stop() else pause()
      ACTION_RELOAD -> if (idle) stop() else reload()
      else -> {
        Log.w(TAG, "unknown action ${intent?.action}: stopping")
        stop()
      }
    }
    return START_NOT_STICKY
  }

  /** Another VPN took the slot. */
  override fun onRevoke() {
    Log.i(TAG, "revoked by the system: another VPN took the slot")
    stop()
  }

  override fun onDestroy() {
    release()
    saveState(running = false, paused = false)
    super.onDestroy()
  }

  private fun start() {
    paused = false
    startForegroundNow()
    if (tun != null) return
    try {
      // Read before the tun exists: afterwards the default network is the tun itself.
      val systemDns = systemDns()
      val established = buildTun().also { tun = it }
      check(engine.start(established, systemDns)) { "firestack did not start" }
      // Not saveState: on the success path a failed write must fail loudly and land in stop() below.
      store.writeState(STATE_RUNNING, "true")
      store.writeState(STATE_PAUSED, "false")
      Log.i(TAG, "started: tun and engine up (sdk ${Build.VERSION.SDK_INT})")
    } catch (failure: Exception) {
      Log.e(TAG, "start failed: ${failure.javaClass.simpleName}: ${failure.message}")
      stop()
    }
  }

  /** The tun goes down so traffic flows normally; the notification stays with a Resume action. */
  private fun pause() {
    release()
    paused = true
    saveState(running = false, paused = true)
    startForegroundNow()
    Log.i(TAG, "paused")
  }

  private fun reload() = engine.reload()

  private fun stop() {
    release()
    paused = false
    saveState(running = false, paused = false)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun release() {
    if (tun != null) Log.i(TAG, "tun closed")
    engine.stop()
    runCatching { tun?.close() }
    tun = null
  }

  /** A failed write must not keep the service from stopping, so it is logged, not thrown. */
  private fun saveState(running: Boolean, paused: Boolean) {
    runCatching {
      store.writeState(STATE_RUNNING, running.toString())
      store.writeState(STATE_PAUSED, paused.toString())
    }.onFailure { Log.e(TAG, "could not save the firewall state: ${it.message}") }
  }

  /**
   * The DNS servers of a network that is not a VPN, comma separated. While another VPN is up the active
   * network is that VPN's, whose DNS would loop; then the first validated non-VPN network is used.
   */
  @Suppress("DEPRECATION")
  private fun systemDns(): String {
    val manager = getSystemService(ConnectivityManager::class.java)
    val plain = manager.allNetworks.filter {
      val caps = manager.getNetworkCapabilities(it)
      caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN) &&
        caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }
    val chosen = plain.firstOrNull { it == manager.activeNetwork }
      ?: plain.firstOrNull { manager.getNetworkCapabilities(it)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true }
      ?: plain.firstOrNull()
      ?: return ""
    return manager.getLinkProperties(chosen)?.dnsServers?.mapNotNull { it.hostAddress }?.joinToString(",").orEmpty()
  }

  private fun buildTun(): ParcelFileDescriptor {
    val builder = Builder().setSession(SESSION_NAME).setMtu(FirewallNetworks.MTU)
    builder
      .addAddress(FirewallNetworks.TUN_IPV4, FirewallNetworks.TUN_IPV4_PREFIX)
      .addAddress(FirewallNetworks.TUN_IPV6, FirewallNetworks.TUN_IPV6_PREFIX)
    builder.addDnsServer(FirewallNetworks.TUN_DNS_IPV4).addDnsServer(FirewallNetworks.TUN_DNS_IPV6)
    builder.addRoute("0.0.0.0", 0).addRoute("::", 0)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      for ((address, length) in FirewallNetworks.LAN_EXCLUSIONS) {
        builder.excludeRoute(IpPrefix(InetAddress.getByName(address), length))
      }
    } else if (!lanNoticeLogged) {
      lanNoticeLogged = true
      Log.i(TAG, "LAN ranges stay inside the tun")
    }
    try {
      builder.addDisallowedApplication(FirewallNetworks.HOMENET_PACKAGE)
    } catch (_: PackageManager.NameNotFoundException) {
      Log.i(TAG, "${FirewallNetworks.HOMENET_PACKAGE} is not installed: nothing to exclude")
    }
    return builder.establish() ?: throw IllegalStateException("establish() returned null")
  }

  private fun ensureChannel() {
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "TunnelWall firewall", NotificationManager.IMPORTANCE_LOW),
    )
  }

  private fun startForegroundNow() {
    val notification = notification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun notification(): Notification {
    val openFirewall = PendingIntent.getActivity(
      this,
      0,
      Intent(Intent.ACTION_VIEW, Uri.parse(FIREWALL_LINK), this, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      PendingIntent.FLAG_IMMUTABLE,
    )
    val toggleAction = if (paused) ACTION_RESUME else ACTION_PAUSE
    val toggle = PendingIntent.getService(
      this,
      1,
      Intent(this, FirewallService::class.java).setAction(toggleAction),
      PendingIntent.FLAG_IMMUTABLE,
    )
    return Notification.Builder(this, CHANNEL_ID)
      .setContentTitle("TunnelWall firewall")
      .setContentText(if (paused) "The firewall is paused." else "The firewall is on.")
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentIntent(openFirewall)
      .addAction(
        Notification.Action.Builder(
          Icon.createWithResource(this, R.mipmap.ic_launcher),
          if (paused) "Resume" else "Pause",
          toggle,
        ).build(),
      )
      .setOngoing(true)
      .build()
  }

  companion object {
    /**
     * True for the actions that start the firewall: ACTION_START, ACTION_RESUME, no action, and the
     * system's VpnService action. Always-on may deliver either of the last two after a reboot; which
     * one is unverified until the Task 13 phone check reads the logged action.
     */
    fun startsOn(action: String?): Boolean =
      action == null || action == VpnService.SERVICE_INTERFACE || action == ACTION_START || action == ACTION_RESUME

    /** A start the user did not ask for in the UI: no action, or the system's VpnService action. */
    fun isImplicitStart(action: String?): Boolean = action == null || action == VpnService.SERVICE_INTERFACE

    const val ACTION_START = FirewallContract.ACTION_START
    const val ACTION_STOP = FirewallContract.ACTION_STOP
    const val ACTION_PAUSE = FirewallContract.ACTION_PAUSE
    const val ACTION_RESUME = FirewallContract.ACTION_RESUME
    const val ACTION_RELOAD = FirewallContract.ACTION_RELOAD

    /** `firewall_state` keys the UI process and the controller read. */
    const val STATE_RUNNING = FirewallContract.STATE_RUNNING
    const val STATE_PAUSED = FirewallContract.STATE_PAUSED
    const val STATE_ENABLED = FirewallContract.STATE_ENABLED
    const val STATE_LAST_START_ACTION = FirewallContract.STATE_LAST_START_ACTION

    private const val TAG = "FirewallService"
    private const val CHANNEL_ID = "firewall"
    private const val NOTIFICATION_ID = 2
    private const val SESSION_NAME = "TunnelWall firewall"
    private const val FIREWALL_LINK = "opentunnel://firewall"

    @Volatile
    private var lanNoticeLogged = false
  }
}
