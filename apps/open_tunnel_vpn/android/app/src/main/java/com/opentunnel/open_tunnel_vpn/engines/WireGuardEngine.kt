package com.opentunnel.open_tunnel_vpn.engines

import android.content.Context
import com.wireguard.android.backend.GoBackend
import com.wireguard.android.backend.Tunnel
import com.wireguard.config.Config
import expo.modules.opentunnelnative.TunnelEventBus
import expo.modules.opentunnelnative.TunnelStateRegistry
import expo.modules.opentunnelnative.TunnelStatus
import expo.modules.opentunnelnative.TrafficTicker
import java.io.BufferedReader
import java.io.StringReader

/**
 * WireGuard engine over the non-root GoBackend of `com.wireguard.android:tunnel`
 * (pinned 1.0.20260102, Apache-2.0).
 *
 * Artifact-verified integration (docs/phase2-session-log.md): GoBackend
 * hosts its own VpnService — `GoBackend$VpnService`, declared by the
 * library manifest and started internally via `context.startService` after
 * `VpnService.prepare` — so this app service is NOT the tun owner on this
 * path. The app service remains the foreground/controller host, and the
 * session itself lives in the library service. `WgQuickBackend` is the
 * root-only backend and is never touched here.
 *
 * Traffic comes from real `GoBackend.getStatistics` byte totals.
 *
 * Kill-switch note (honest semantics — every reported state mirrors the
 * real device state): with library-owned
 * hosting there is no app-side Builder over which to block packets, so
 * `enableKillSwitch` is not honoured engine-side on this path in phase 2.
 * The OS-level "Block connections without VPN" switch remains reachable via
 * `openSystemVpnSettings()`; this limitation is recorded in the session
 * log. The VpnService bypass opt-out is never called anywhere in this
 * codebase (grep gate in the phase acceptance list).
 */
class WireGuardEngine(context: Context) : TunnelEngine {

  override val hostsThroughAppService = false

  private val appContext = context.applicationContext
  private val tunnel = ActiveTunnel("TunnelWall")
  private var backend: GoBackend? = null

  override fun start(config: EngineConfig): EngineStart {
    val engineBackend = engine()

    // Payload first class; UI-provided excluded apps ride the parsed
    // [Interface] section via the published ExcludedApplications attribute
    // (Interface exposes getExcludedApplications in this artifact).
    val merged = mergeDisallowedApps(config.configText, config.disallowedApps)
    val parsed = Config.parse(BufferedReader(StringReader(merged)))

    val resultingState = engineBackend.setState(tunnel, Tunnel.State.UP, parsed)
    if (resultingState == Tunnel.State.DOWN) {
      throw IllegalStateException("wireguard backend stayed DOWN after setState")
    }
    // The session is up in the library service; the `connected` status
    // arrives through ActiveTunnel.onStateChange (single authority).
    return EngineStart(connected = true)
  }

  override fun stop() {
    val engineBackend = backend ?: return
    // Best effort DOWN; ActiveTunnel.onStateChange reports the resulting
    // disconnect through the registry, and stopTunnel() converges the state
    // even if this call throws mid-teardown.
    runCatching { engineBackend.setState(tunnel, Tunnel.State.DOWN, null) }
  }

  override fun trafficCounters(): Pair<Long, Long>? {
    val engineBackend = backend ?: return null
    if (!tunnelActive) return null
    val statistics = engineBackend.getStatistics(tunnel)
    return statistics.totalRx() to statistics.totalTx()
  }

  private val tunnelActive: Boolean
    get() = backend?.getState(tunnel) == Tunnel.State.UP

  /** Single GoBackend instance per process; the constructor loads the
   * bundled wireguard-go shared library (libwg-go.so in the AAR). */
  private fun engine(): GoBackend {
    var current = backend
    if (current == null) {
      synchronized(this) {
        current = backend ?: GoBackend(appContext).also { backend = it }
      }
    }
    return current!!
  }

  private fun mergeDisallowedApps(configText: String, disallowedApps: List<String>): String {
    if (disallowedApps.isEmpty()) return configText
    val lines = configText.lineSequence().toMutableList()
    val interfaceAt = lines.indexOfFirst { it.trim().equals("[Interface]", ignoreCase = true) }
    require(interfaceAt >= 0) { "wireguard payload has no [Interface] section" }
    val packages = disallowedApps.joinToString(", ") { appId -> appId.trim() }
    lines.add(interfaceAt + 1, "ExcludedApplications = $packages")
    return lines.joinToString("\n")
  }

  /** One tunnel per engine instance, named for the single active node;
   * state callbacks update the shared registry and the traffic cadence. */
  private inner class ActiveTunnel(private val tunnelName: String) : Tunnel {
    override fun getName(): String = tunnelName

    override fun onStateChange(state: Tunnel.State) {
      when (state) {
        Tunnel.State.UP -> reportConnected()
        Tunnel.State.DOWN -> reportDisconnected()
        Tunnel.State.TOGGLE -> {
          // The engine only ever requests UP and DOWN; if TOGGLE still
          // arrives, mirror the backend's real state instead of guessing.
          if (tunnelActive) reportConnected() else reportDisconnected()
        }
      }
    }

    private fun reportConnected() {
      TunnelStateRegistry.setStatus(TunnelStatus.CONNECTED)
      TunnelEventBus.postStatus(TunnelStatus.CONNECTED, null)
      TrafficTicker.start {
        trafficCounters()
          ?: throw IllegalStateException(
            "engine counters unavailable (not active) — ticker falls back to TrafficStats",
          )
      }
    }

    private fun reportDisconnected() {
      TrafficTicker.stop()
      TunnelStateRegistry.setStatus(TunnelStatus.DISCONNECTED)
      TunnelEventBus.postStatus(TunnelStatus.DISCONNECTED, null)
    }
  }
}
