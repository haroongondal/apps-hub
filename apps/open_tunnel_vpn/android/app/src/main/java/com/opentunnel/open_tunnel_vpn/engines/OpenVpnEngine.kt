package com.opentunnel.open_tunnel_vpn.engines

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.system.Os
import de.blinkt.openvpn.core.ConfigParser
import de.blinkt.openvpn.core.ConnectionStatus
import de.blinkt.openvpn.core.GlobalPreferences
import de.blinkt.openvpn.core.IOpenVPNServiceInternal
import de.blinkt.openvpn.core.OpenVPNService
import de.blinkt.openvpn.core.ProfileManager
import de.blinkt.openvpn.core.VPNLaunchHelper
import de.blinkt.openvpn.core.VpnStatus
import expo.modules.opentunnelnative.ServiceContracts
import expo.modules.opentunnelnative.TrafficTicker
import expo.modules.opentunnelnative.TunnelEventBus
import expo.modules.opentunnelnative.TunnelStateRegistry
import expo.modules.opentunnelnative.TunnelStatus
import de.blinkt.openvpn.core.keepVPNAlive
import java.io.StringReader
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// ics-openvpn hosts its own VpnService; the manifest pulls it into the app process so VpnStatus listeners here see it.
class OpenVpnEngine(context: Context) : TunnelEngine {

  override val hostsThroughAppService = false

  private val appContext = context.applicationContext
  @Volatile private var totals: Pair<Long, Long>? = null
  @Volatile private var started = false
  // Set by this session's own first state, so the replayed state of a previous session is ignored.
  @Volatile private var armed = false
  @Volatile private var ended: CountDownLatch? = null
  private var control: IOpenVPNServiceInternal? = null
  private val main = Handler(Looper.getMainLooper())
  private val connectTimeout = Runnable {
    fail("The server didn't answer within ${CONNECT_TIMEOUT_MS / 1000} seconds. Pick another server.")
  }

  private val controlConnection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName, binder: IBinder) {
      control = IOpenVPNServiceInternal.Stub.asInterface(binder)
    }

    override fun onServiceDisconnected(name: ComponentName) {
      control = null
    }
  }

  private val stateListener = object : VpnStatus.StateListener {
    override fun updateState(
      state: String?,
      logmessage: String?,
      localizedResId: Int,
      level: ConnectionStatus,
      intent: Intent?,
    ) {
      when (level) {
        ConnectionStatus.LEVEL_CONNECTED -> if (started && armed) {
          main.removeCallbacks(connectTimeout)
          TunnelStateRegistry.setStatus(TunnelStatus.CONNECTED)
          TunnelEventBus.postStatus(TunnelStatus.CONNECTED, null)
          TrafficTicker.start {
            totals ?: throw IllegalStateException("no byte count yet — ticker falls back to TrafficStats")
          }
        }
        // Posted: fail() unregisters this listener, and VpnStatus iterates a fail-fast Vector.
        ConnectionStatus.LEVEL_AUTH_FAILED -> main.post {
          fail("The server rejected the connection (authentication failed). Pick another server.")
        }
        ConnectionStatus.LEVEL_WAITING_FOR_USER_INPUT -> main.post {
          fail("This server asks for a username and password, which OpenTunnel does not support. Pick another server.")
        }
        ConnectionStatus.LEVEL_NOTCONNECTED -> {
          ended?.countDown()
          if (started && armed && TunnelStateRegistry.statusState != TunnelStatus.ERROR) {
            started = false
            TrafficTicker.stop()
            TunnelStateRegistry.setStatus(TunnelStatus.DISCONNECTED)
            TunnelEventBus.postStatus(TunnelStatus.DISCONNECTED, null)
            release()
          }
        }
        else -> if (started && !armed) {
          armed = true
        } else if (started && TunnelStateRegistry.statusState == TunnelStatus.CONNECTED) {
          TunnelStateRegistry.setStatus(TunnelStatus.REASSERTING)
          TunnelEventBus.postStatus(TunnelStatus.REASSERTING, null)
        }
      }
    }

    override fun setConnectedVPN(uuid: String?) = Unit
  }

  private val byteCountListener = VpnStatus.ByteCountListener { inBytes, outBytes, _, _ ->
    totals = inBytes to outBytes
  }

  override fun start(config: EngineConfig): EngineStart {
    val parser = ConfigParser()
    parser.parseConfig(StringReader(config.configText))
    val profile = parser.convertProfile()
    profile.mName = "OpenTunnel"
    if (config.disallowedApps.isNotEmpty()) {
      profile.mAllowedAppsVpn = HashSet(config.disallowedApps)
      profile.mAllowedAppsVpnAreDisallowed = true
    }
    if (config.dnsServers.isNotEmpty()) {
      profile.mOverrideDNS = true
      profile.mDNS1 = config.dnsServers[0]
      profile.mDNS2 = config.dnsServers.getOrElse(1) { "" }
    }
    val problem = profile.checkProfile(appContext)
    if (problem != de.blinkt.openvpn.R.string.no_error_found) {
      throw IllegalArgumentException(appContext.getString(problem))
    }

    // enableKillSwitch has no app-side Builder here (same limit as WireGuard); ics blocks unused address families.
    armed = false
    VpnStatus.addStateListener(stateListener)
    VpnStatus.addByteCountListener(byteCountListener)
    ProfileManager.setTemporaryProfile(appContext, profile)
    deleteProfileFiles(appContext)
    started = true
    VPNLaunchHelper.startOpenVpn(profile, appContext, "OpenTunnel", true)
    main.postDelayed(connectTimeout, CONNECT_TIMEOUT_MS)
    appContext.bindService(
      Intent(appContext, OpenVPNService::class.java).setAction(OpenVPNService.START_SERVICE),
      controlConnection,
      Context.BIND_AUTO_CREATE,
    )
    return EngineStart(connected = true)
  }

  override fun stop() {
    val wasRunning = started
    started = false
    armed = false
    main.removeCallbacks(connectTimeout)
    if (wasRunning) {
      val down = CountDownLatch(1).also { ended = it }
      val ctl = control
      if (ctl != null) runCatching { ctl.stopVPN(false) } else appContext.stopService(Intent(appContext, OpenVPNService::class.java))
      runCatching { appContext.unbindService(controlConnection) }
      // A start() right after this must not take the old process's exit for its own.
      down.await(STOP_WAIT_MS, TimeUnit.MILLISECONDS)
      ended = null
    }
    control = null
    VpnStatus.removeStateListener(stateListener)
    VpnStatus.removeByteCountListener(byteCountListener)
    clearPersisted(appContext)
    totals = null
  }

  override fun trafficCounters(): Pair<Long, Long>? = totals

  private fun fail(message: String) {
    if (!started) return
    val wasUp = TunnelStateRegistry.statusState.let { it == TunnelStatus.CONNECTED || it == TunnelStatus.REASSERTING }
    stop()
    TrafficTicker.stop()
    TunnelStateRegistry.setStatus(TunnelStatus.ERROR, message)
    TunnelEventBus.postStatus(TunnelStatus.ERROR, message)
    // The app answers a dropped tunnel by moving to another relay (App.tsx), which needs the foreground service held.
    release(hold = wasUp)
  }

  private fun release(hold: Boolean = false) {
    appContext.startService(
      Intent()
        .setClassName(appContext, ServiceContracts.SERVICE_CLASS_NAME)
        .setAction(ServiceContracts.ACTION_RELEASE)
        .putExtra(ServiceContracts.EXTRA_HOLD, hold),
    )
  }

  companion object {
    private const val CONNECT_TIMEOUT_MS = 30_000L
    private const val STOP_WAIT_MS = 3_000L

    // ics saves the profile (with keys) and an always-reconnect job; a fresh process must not resurrect a tunnel nobody controls.
    private fun clearPersisted(context: Context) {
      ProfileManager.setConnectedVpnProfileDisconnected(context)
      keepVPNAlive.unscheduleKeepVPNAliveJobService(context)
      deleteProfileFiles(context)
    }

    private fun deleteProfileFiles(context: Context) {
      for (ext in listOf("vp", "cp", "cpold")) context.getFileStreamPath("temporary-vpn-profile.$ext").delete()
    }

    // ics-openvpn's own Application class does this; the system may restart its service in a fresh process.
    fun initProcess(context: Context) {
      GlobalPreferences.setInstance(false, false, false)
      clearPersisted(context)
      // shortcut: the emulator on Apple M4+ hosts reports SVE it can't run, so OpenSSL's probe dies with SIGILL; emulator only.
      if (Build.HARDWARE == "ranchu") Os.setenv("OPENSSL_armcap", "0x7d", false)
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(NotificationManager::class.java)
      for ((id, name) in listOf(
        OpenVPNService.NOTIFICATION_CHANNEL_BG_ID to "VPN connection",
        OpenVPNService.NOTIFICATION_CHANNEL_NEWSTATUS_ID to "VPN status changes",
        OpenVPNService.NOTIFICATION_CHANNEL_USERREQ_ID to "VPN requests",
      )) {
        manager.createNotificationChannel(NotificationChannel(id, name, NotificationManager.IMPORTANCE_LOW))
      }
    }
  }
}
