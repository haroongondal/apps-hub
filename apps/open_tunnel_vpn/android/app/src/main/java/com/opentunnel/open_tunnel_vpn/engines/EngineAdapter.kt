package com.opentunnel.open_tunnel_vpn.engines

import android.content.Context
import android.os.ParcelFileDescriptor
import expo.modules.opentunnelnative.VpnPayload

/**
 * What an engine receives. `configText` is the already-sanitized payload —
 * VPN Gate `.ovpn` text was rewritten once by open-tunnel-core
 * (`sanitizeOpenVpnConfig`), and no engine logs it (AGENTS rules #4/#5).
 * ics-openvpn parses it into a profile and regenerates the config it hands
 * the openvpn binary on stdin (cipher directives still once); its saved
 * profile file is deleted straight away (OpenVpnEngine.clearPersisted).
 */
data class EngineConfig(
  val nodeId: String,
  val serverIp: String,
  val serverPort: Int,
  val protocol: String,
  val configText: String,
  val dnsServers: List<String>,
  val enableKillSwitch: Boolean,
  val disallowedApps: List<String>,
  /** Set only for hosted engines: the tun descriptor this service built. */
  val hostFd: ParcelFileDescriptor? = null,
)

/**
 * Start outcome: the engine either opened the tunnel, or reports that the
 * session is hosted elsewhere (the pinned GoBackend hosts its own
 * VpnService — verified against the 1.0.20260102 artifact; see
 * docs/phase2-session-log.md).
 */
data class EngineStart(
  val connected: Boolean,
  val message: String? = null,
)

interface TunnelEngine {
  /** True when the engine expects THIS service to have built the tun
   * interface (Builder/kill-switch path — plan §6); false when the engine
   * hosts its own service and the app acts as controller. */
  val hostsThroughAppService: Boolean

  fun start(config: EngineConfig): EngineStart

  fun stop()

  /** Live (totalRx, totalTx) or null when the engine has no counters. */
  fun trafficCounters(): Pair<Long, Long>?
}

/**
 * Thrown by engine paths whose external core is not integrated. The typed
 * `ENGINE_UNAVAILABLE` failure is the contract (AGENTS rule #6): no
 * stand-in state is ever produced for a missing engine.
 */
class EngineUnavailableException(message: String) : IllegalStateException(message)

/**
 * Router: pick the engine from the payload-sniffed protocol, never from
 * the endpoint name (AGENTS rule #1). VPN Gate rows always carry OpenVPN
 * payloads; genuine `.conf` text routes to WireGuard.
 */
object EngineAdapter {
  fun engineFor(protocol: String, context: Context): TunnelEngine =
    when (protocol) {
      VpnPayload.PROTOCOL_WIREGUARD -> WireGuardEngine(context)
      VpnPayload.PROTOCOL_OPENVPN -> OpenVpnEngine(context)
      else -> throw EngineUnavailableException("no engine for protocol $protocol")
    }
}
