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
import com.opentunnel.open_tunnel_vpn.engines.EngineAdapter
import com.opentunnel.open_tunnel_vpn.engines.EngineConfig
import com.opentunnel.open_tunnel_vpn.engines.EngineUnavailableException
import com.opentunnel.open_tunnel_vpn.engines.TunnelEngine
import expo.modules.opentunnelnative.ServiceContracts
import expo.modules.opentunnelnative.TunnelEventBus
import expo.modules.opentunnelnative.TunnelStateRegistry
import expo.modules.opentunnelnative.TunnelStatus
import expo.modules.opentunnelnative.TrafficTicker
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
  private val release = Runnable {
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
        TrafficTicker.stop()
        // Android 15+ cuts a background app's network about 5 s after its last foreground service ends.
        if (intent?.getBooleanExtra(ServiceContracts.EXTRA_HOLD, false) == true) main.postDelayed(release, HOLD_MS) else release.run()
      }
      else -> {
        // No active command (e.g. a stale or system-delivered intent):
        // tear down the notice and end this instance cleanly; the registry
        // keeps its true state.
        stopForegroundCompat()
        stopSelf()
      }
    }
    return START_NOT_STICKY
  }

  /** Starts the selected engine; state transitions flow through engine
   * callbacks while failures converge on the typed error path. */
  private fun startTunnel(config: EngineConfig) {
    val previous = engine
    if (previous != null) {
      engine = null
      runCatching { previous.stop() }
    }

    TunnelStateRegistry.setStatus(TunnelStatus.CONNECTING)
    TunnelEventBus.postStatus(TunnelStatus.CONNECTING, null)

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

  /** Tidy stop: disconnecting → engine down → disconnected, notification
   * removed, ticker stopped, service ends itself. */
  private fun stopTunnel() {
    TunnelStateRegistry.setStatus(TunnelStatus.DISCONNECTING)
    TunnelEventBus.postStatus(TunnelStatus.DISCONNECTING, null)

    val active = engine
    engine = null
    if (active != null) runCatching { active.stop() }

    TrafficTicker.stop()
    TunnelStateRegistry.setStatus(TunnelStatus.DISCONNECTED)
    TunnelEventBus.postStatus(TunnelStatus.DISCONNECTED, null)

    stopForegroundCompat()
    stopSelf()
  }

  /** The system revoked the VPN (another app started one, or the user
   * disconnected OS-side). The engine must not linger; state reports the
   * true (system-owned) outcome. */
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
    TrafficTicker.stop()
    val active = engine
    engine = null
    if (active != null) runCatching { active.stop() }

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
    builder.setSession("OpenTunnel")
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
        "OpenTunnel VPN",
        NotificationManager.IMPORTANCE_LOW,
      )
      channel.description = "Status of the OpenTunnel VPN service."
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
      .setContentTitle("OpenTunnel")
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
    private const val CHANNEL_ID = "tunnel"
    private const val NOTIFICATION_ID = 1
    // Covers the app's relay refetch and probe sweep after a drop.
    private const val HOLD_MS = 60_000L
  }
}
