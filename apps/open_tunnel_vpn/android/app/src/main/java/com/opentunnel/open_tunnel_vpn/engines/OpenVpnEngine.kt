package com.opentunnel.open_tunnel_vpn.engines

import expo.modules.opentunnelnative.ServiceContracts

/**
 * OpenVPN path for VPN Gate `.ovpn` payloads. Those payloads arrive here
 * pre-sanitized by open-tunnel-core (`sanitizeOpenVpnConfig` — cipher
 * directives injected exactly once, unsupported lines stripped) and must
 * flow through the engine unchanged; no engine re-injects or logs them
 * (AGENTS rule #4).
 *
 * The real OpenVPN 2.x core (vendored ics-openvpn) is a GPLv2 build gated
 * on engine decision G1 and on a project license decision the owner has not
 * made yet (docs/phase2-session-log.md §Gates). Until that decision lands,
 * starting an OpenVPN tunnel is the typed explicit failure — the same
 * `ERR_ENGINE_UNAVAILABLE` the JS contract defines, surfaced by the module
 * before any service work and again here for defense in depth. Every
 * reported state is real; there are no invented states or silent no-ops.
 */
class OpenVpnEngine : TunnelEngine {

  override val hostsThroughAppService = true

  override fun start(config: EngineConfig): EngineStart =
    throw EngineUnavailableException(ServiceContracts.OPENVPN_GATE_MESSAGE)

  override fun stop() {
    // Nothing to rewind: the engine was never started (start throws).
  }

  override fun trafficCounters(): Pair<Long, Long>? = null
}
