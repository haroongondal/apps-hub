package com.opentunnel.open_tunnel_vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.util.Log
import com.opentunnel.open_tunnel_vpn.firewall.FirewallService
import com.opentunnel.open_tunnel_vpn.engines.EngineAdapter
import com.opentunnel.open_tunnel_vpn.engines.EngineConfig
import com.opentunnel.open_tunnel_vpn.engines.EngineUnavailableException
import com.opentunnel.open_tunnel_vpn.engines.TunnelEngine
import expo.modules.opentunnelnative.ServiceContracts
import expo.modules.opentunnelnative.TunnelEventBus
import expo.modules.opentunnelnative.TunnelStateRegistry
import expo.modules.opentunnelnative.TunnelStatus
import expo.modules.opentunnelnative.TrafficTicker
import expo.modules.opentunnelnative.firewall.FirewallContract
import expo.modules.opentunnelnative.firewall.FirewallHandover
import expo.modules.opentunnelnative.firewall.FirewallStartPolicy
import expo.modules.opentunnelnative.firewall.FirewallStore
import org.json.JSONArray
import org.json.JSONObject

/**
 * The app's own VpnService host — package `com.opentunnel.open_tunnel_vpn`,
 * exactly what the manifest declaration `.OpenTunnelVpnService` resolves to
 * (plan §4.4; the Flutter snapshot block at commit a8cf6e9 is the manifest
 * source of truth).
 *
 * Roles:
 *  - standalone: foreground-service duties — notification channel, ongoing
 *    notice, the API 34+ `specialUse` type; started via the module's FGS
 *    hand-off, and `startForeground()` is called before any engine work so
 *    the 5-second window can never be missed.
 *  - hosted path: when an engine declares `hostsThroughAppService` (the
 *    future licensed OpenVPN core), this service builds the tun interface
 *    itself, including the IPv6 leak blackhole and the kill switch, and
 *    hands the descriptor to the engine.
 *  - controller path: the pinned WireGuard GoBackend hosts its own service
 *    (verified in the artifact); this service keeps the FGS, routes engine
 *    state into the shared registry/event bus, and governs the ticker.
 *
 * The VpnService bypass opt-out is never called here or anywhere else
 * (AGENTS rule #3).
 * POST_NOTIFICATIONS on Android 13+ is requested at runtime from the UI
 * process; a denial never blocks the tunnel.
 */
class OpenTunnelVpnService : VpnService() {

  private var engine: TunnelEngine? = null
  private val main = Handler(Looper.getMainLooper())

  // The firewall lives in the :firewall process and shares only this store (plan Task 6).
  private val firewallStore by lazy { FirewallStore(this) }

  /** True once this service stopped a running firewall to take the VPN slot; it is given back when the engine ends. */
  private var firewallStopped = false
  private var pendingStart: Runnable? = null
  // A hold means the app is moving to another relay: the firewall returns only when the hold really ends,
  // since a new START removes this Runnable and keeps firewallStopped.
  private val release = Runnable {
    restoreFirewall()
    stopForegroundCompat()
    stopSelf()
  }

  override fun onCreate() {
    super.onCreate()
    ensureChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Foreground guarantee first — the 5-second window is never raced by
    // engine setup.
    main.removeCallbacks(release)
    startForegroundNow()
    when (intent?.action) {
      ServiceContracts.ACTION_START -> {
        val config = parseEngineConfig(intent.getStringExtra(ServiceContracts.EXTRA_CONFIG))
        if (config == null) {
          failStart("tunnel config missing or malformed (contract field check failed)")
        } else {
          startTunnel(config)
        }
      }
      ServiceContracts.ACTION_STOP -> stopTunnel()
      // The engine already ended on its own and reported the final state.
      ServiceContracts.ACTION_RELEASE -> {
        engine?.let { runCatching { it.stop() } }
        engine = null
        setServerActive(false)
        TrafficTicker.stop()
        // Android 15+ cuts a background app's network about 5 s after its last foreground service ends.
        if (intent?.getBooleanExtra(ServiceContracts.EXTRA_HOLD, false) == true) main.postDelayed(release, HOLD_MS) else release.run()
      }
      else -> {
        // No active command (e.g. a stale or system-delivered intent):
        // tear down the notice and end this instance cleanly; the registry
        // keeps its true state.
        val engineRunning = engine != null || pendingStart != null
        if (forwardsToFirewall(intent?.action, engineRunning, firewallState(FirewallService.STATE_ENABLED))) {
          Log.i(TAG, "system start ${intent?.action}: forwarded to the firewall")
          sendToFirewall(FirewallService.ACTION_START)
        }
        stopForegroundCompat()
        stopSelf()
      }
    }
    return START_NOT_STICKY
  }

  /** Stops a running firewall, then starts the selected engine; state transitions flow through engine
   * callbacks while failures converge on the typed error path. */
  private fun startTunnel(config: EngineConfig) {
    cancelPendingStart()
    val previous = engine
    if (previous != null) {
      engine = null
      runCatching { previous.stop() }
    }

    TunnelStateRegistry.setStatus(TunnelStatus.CONNECTING)
    TunnelEventBus.postStatus(TunnelStatus.CONNECTING, null)

    setServerActive(true)
    handOverFromFirewall { startEngine(config) }
  }

  private fun startEngine(config: EngineConfig) {
    try {
      val selected = EngineAdapter.engineFor(config.protocol, this)
      var hostFd: ParcelFileDescriptor? = null
      if (selected.hostsThroughAppService) {
        // Hosted engines own the Builder baseline: leak blackhole + DNS +
        // split app exclusions — plan §6, verbatim behavior.
        hostFd = buildHostInterface(config)
      }
      engine = selected
      val start = selected.start(config.copy(hostFd = hostFd))
      if (!start.connected) {
        failStart(start.message ?: "engine did not reach a connected state")
      }
    } catch (failure: Exception) {
      failStart(describe(failure))
    }
  }

  /**
   * A running firewall holds the VPN slot. Asks it to stop, then runs [start] once it reports stopped, or
   * after [FirewallHandover.STOP_TIMEOUT_MS] whatever it reports (stopping the firewall service outright
   * first): a server connection never fails because the firewall held the slot. A stale `running` left by a
   * dead `:firewall` process is cleared by that stop request, because the process restarts only to stop and
   * write "false"; the timeout covers the rest.
   */
  private fun handOverFromFirewall(start: () -> Unit) {
    val startedAt = SystemClock.elapsedRealtime()
    if (FirewallHandover.shouldStopFirewall(
        firewallState(FirewallService.STATE_RUNNING),
        firewallState(FirewallService.STATE_ENABLED),
      )
    ) {
      // A firewall the user paused stays off afterwards (R21); one that was on, or on its way back, returns.
      if (firewallState(FirewallService.STATE_PAUSED) != "true") firewallStopped = true
      sendToFirewall(FirewallService.ACTION_STOP)
    }
    // Polled only after the STOP: a start under way has claimed running (FirewallService.start), so it is waited out.
    val poll = object : Runnable {
      override fun run() {
        val running = firewallState(FirewallService.STATE_RUNNING)
        val now = SystemClock.elapsedRealtime()
        val timeout = FirewallHandover.STOP_TIMEOUT_MS
        if (!FirewallHandover.canStartEngine(running, now, startedAt, timeout)) {
          main.postDelayed(this, FirewallHandover.POLL_MS)
          return
        }
        pendingStart = null
        if (FirewallHandover.shouldForceStop(running, now, startedAt, timeout)) {
          Log.w(TAG, "the firewall did not stop within ${timeout} ms: stopping its service")
          runCatching { stopService(Intent(this@OpenTunnelVpnService, FirewallService::class.java)) }
            .onFailure { Log.w(TAG, "could not stop the firewall service: ${it.message}") }
        }
        start()
      }
    }
    pendingStart = poll
    poll.run()
  }

  private fun cancelPendingStart() {
    pendingStart?.let { main.removeCallbacks(it) }
    pendingStart = null
  }

  /** Gives the VPN slot back when the engine ends, if this service took it and the user still has the firewall on. */
  private fun restoreFirewall() {
    if (!firewallStopped || pendingStart != null) return
    firewallStopped = false
    if (FirewallHandover.shouldRestartAfterEngine(firewallState(FirewallService.STATE_ENABLED))) {
      sendToFirewall(FirewallService.ACTION_START)
    }
  }

  /** A failed read counts as no firewall state: a server connection never waits on a store it cannot read. */
  private fun firewallState(key: String): String? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
    return runCatching { firewallStore.readState(key) }
      .onFailure { Log.w(TAG, "could not read the firewall state: ${it.message}") }
      .getOrNull()
  }

  /** The firewall refuses every start while this is "true"; it is cleared before any restore START is sent. */
  private fun setServerActive(active: Boolean) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    runCatching { firewallStore.writeState(FirewallContract.STATE_SERVER_ACTIVE, active.toString()) }
      .onFailure { Log.w(TAG, "could not save the server state: ${it.message}") }
  }

  private fun sendToFirewall(action: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    runCatching { startForegroundService(Intent(this, FirewallService::class.java).setAction(action)) }
      .onFailure { Log.w(TAG, "could not send $action to the firewall: ${it.message}") }
  }

  /** Tidy stop: disconnecting → engine down → disconnected, notification
   * removed, ticker stopped, service ends itself. */
  private fun stopTunnel() {
    cancelPendingStart()
    TunnelStateRegistry.setStatus(TunnelStatus.DISCONNECTING)
    TunnelEventBus.postStatus(TunnelStatus.DISCONNECTING, null)

    val active = engine
    engine = null
    if (active != null) runCatching { active.stop() }

    TrafficTicker.stop()
    TunnelStateRegistry.setStatus(TunnelStatus.DISCONNECTED)
    TunnelEventBus.postStatus(TunnelStatus.DISCONNECTED, null)
    setServerActive(false)
    restoreFirewall()

    stopForegroundCompat()
    stopSelf()
  }

  /** The system revoked the VPN (another app started one, or the user
   * disconnected OS-side). The engine must not linger; state reports the
   * true (system-owned) outcome. The firewall is not restored here: another VPN holds the slot and a
   * firewall start would take it back. */
  override fun onRevoke() {
    val active = engine
    engine = null
    if (active != null) runCatching { active.stop() }
    TrafficTicker.stop()
    TunnelStateRegistry.setStatus(TunnelStatus.DISCONNECTED)
    TunnelEventBus.postStatus(TunnelStatus.DISCONNECTED, null)
    stopForegroundCompat()
    stopSelf()
  }

  override fun onDestroy() {
    main.removeCallbacks(release)
    cancelPendingStart()
    TrafficTicker.stop()
    val active = engine
    engine = null
    if (active != null) runCatching { active.stop() }
    // Revoke and a stale intent end here with the engine stopped but no stopTunnel.
    setServerActive(false)

    // Final convergence: leave the registry only on true terminal states.
    val status = TunnelStateRegistry.statusState
    if (status != TunnelStatus.DISCONNECTED && status != TunnelStatus.ERROR) {
      TunnelStateRegistry.setStatus(TunnelStatus.DISCONNECTED)
      TunnelEventBus.postStatus(TunnelStatus.DISCONNECTED, null)
    }
    super.onDestroy()
  }

  /** Typed failure: `error` is terminal with a safe message (native
   * wording; never keys, certs, or config bodies — AGENTS rules #4/#5). */
  private fun failStart(message: String) {
    engine = null
    TrafficTicker.stop()
    TunnelStateRegistry.setStatus(TunnelStatus.ERROR, message)
    TunnelEventBus.postStatus(TunnelStatus.ERROR, message)
    setServerActive(false)
    restoreFirewall()
    stopForegroundCompat()
    stopSelf()
  }

  /** Safe exception taxonomy: class name + guarded message text. Library
   * exceptions carry enum-typed reasons, never the config body. */
  private fun describe(failure: Exception): String {
    val detail = failure.message?.take(200)
    return if (detail.isNullOrEmpty()) {
      failure.javaClass.simpleName
    } else {
      "${failure.javaClass.simpleName}: $detail"
    }
  }

  /** Hosted-engine Builder baseline (plan §6, committed before the engine
   * exists so the kill-switch semantics stay real, not aspirational). */
  private fun buildHostInterface(config: EngineConfig): ParcelFileDescriptor {
    val builder = Builder()
    builder.setSession("TunnelWall")
    builder.setMtu(1420)

    val dnsServers =
      if (config.dnsServers.isEmpty()) listOf("1.1.1.1", "9.9.9.9") else config.dnsServers
    for (dnsServer in dnsServers) builder.addDnsServer(dnsServer)

    // IPv6 leak blackhole — always emitted (a payload that itself defines
    // IPv6 must replace this behavior when the hosted engine lands).
    builder.addAddress("fd00::1", 128)
    builder.addRoute("::", 0)

    for (appId in config.disallowedApps) builder.addDisallowedApplication(appId)

    // In-app packet blocking for hosted engines. `setBlocking(boolean)` was
    // verified against the installed android-36 platform jar (API 22+);
    // the bypass opt-out hole stays uncalled.
    if (config.enableKillSwitch) builder.setBlocking(true)

    val descriptor: ParcelFileDescriptor = builder.establish()
      ?: throw EngineUnavailableException("could not establish the tun interface")
    return descriptor
  }

  /** Contract-shaped JSON → EngineConfig; malformed payloads never pass. */
  private fun parseEngineConfig(raw: String?): EngineConfig? {
    if (raw.isNullOrEmpty()) return null
    return try {
      val json = JSONObject(raw)
      EngineConfig(
        nodeId = json.getString("nodeId"),
        serverIp = json.getString("serverIp"),
        serverPort = json.getInt("serverPort"),
        protocol = json.getString("protocol"),
        configText = json.getString("configText"),
        dnsServers = jsonStringArray(json, "dnsServers"),
        enableKillSwitch = json.getBoolean("enableKillSwitch"),
        disallowedApps = jsonStringArray(json, "disallowedApps"),
      )
    } catch (parseFailure: Exception) {
      null
    }
  }

  private fun jsonStringArray(json: JSONObject, key: String): List<String> {
    val array: JSONArray = json.getJSONArray(key)
    return List(array.length()) { index -> array.getString(index) }
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
      val channel = NotificationChannel(
        CHANNEL_ID,
        "TunnelWall VPN",
        NotificationManager.IMPORTANCE_LOW,
      )
      channel.description = "Status of the TunnelWall VPN service."
      manager.createNotificationChannel(channel)
    }
  }

  private fun startForegroundNow() {
    val notification = tunnelNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun tunnelNotification(): Notification {
    val openApp = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      PendingIntent.FLAG_IMMUTABLE,
    )
    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(this, CHANNEL_ID)
      } else {
        Notification.Builder(this)
      }
    return builder
      .setContentTitle("TunnelWall")
      .setContentText("VPN tunnel service running")
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentIntent(openApp)
      .setOngoing(true)
      .build()
  }

  private fun stopForegroundCompat() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
  }

  companion object {
    /**
     * Always-on and the boot start reach this service, the first `android.net.VpnService` filter in the manifest,
     * not FirewallService. They belong to the firewall when no server engine runs and its switch is on.
     */
    fun forwardsToFirewall(action: String?, engineRunning: Boolean, enabled: String?): Boolean =
      FirewallService.isImplicitStart(action) && !engineRunning && FirewallStartPolicy.startOnNullAction(enabled)

    private const val TAG = "OpenTunnelVpnService"
    private const val CHANNEL_ID = "tunnel"
    private const val NOTIFICATION_ID = 1
    // Covers the app's relay refetch and probe sweep after a drop.
    private const val HOLD_MS = 60_000L
  }
}
