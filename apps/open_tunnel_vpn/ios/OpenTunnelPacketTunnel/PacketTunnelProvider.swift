import Foundation
import NetworkExtension

/**
 * OpenTunnel packet-tunnel provider (plan §6, command §2).
 *
 * Lifecycle:
 *  1. `startTunnel(options:)` reads the single active config hand-off from
 *     the App Group (the module pod wrote it on `startTunnel(config)`),
 *     validates size/staleness/required keys typed, then builds real
 *     `NEPacketTunnelNetworkSettings` (MTU 1420, IPv4 capture topology,
 *     all-DNS matching, IPv6 default route so IPv6 cannot leak around an
 *     IPv4-only node), routes the payload by sniffed protocol, and starts
 *     the engine — which is typed-gated with honest reason strings (G1
 *     GPLv2 port decision for OpenVPN; G2 Go-toolchain blocker for
 *     wireguard-go). A gate failure cancels with
 *     `NEProviderStopReason.configurationFailed` — the tunnel is never
 *     silently "connected".
 *  2. `stopTunnel(with:completionHandler:)` flushes counters once and
 *     clears the shared status keys, then completes.
 *
 * Memory and privacy posture (AGENTS rule #2): the hand-off text is parsed
 * for routing only and dropped right after; nothing here touches the
 * network, caches payload blobs, or decodes upstream catalog encodings,
 * and nothing logs payload text. Counters are cumulative byte totals; the
 * module owns the ≤1 Hz cadence.
 */
class PacketTunnelProvider: NEPacketTunnelProvider {
  /** Format of the provider-published error strings (never payload text). */
  private enum ProviderErrorMessages {
    static let engineUnavailablePrefix = "tunnel engine unavailable on iOS: "
  }

  private let settingsAddress = "198.18.31.1"
  private let settingsSubnetMask = "255.255.255.0"
  private let settingsDnsFallback = ["9.9.9.9", "149.112.112.112"]
  // MARK: Start

  override func startTunnel(
    options: [String: NSObject]?,
    completionHandler: @escaping (Error?) -> Void
  ) {
    // 1. Read + validate the hand-off (size, staleness, keys — typed).
    let stored: TunnelHandoff
    switch SharedPayload.readActiveConfig() {
    case let .success(handoff):
      stored = handoff
    case let .failure(failure):
      SharedPayload.writeProviderStatus(
        state: TunnelContracts.statusError,
        message: failure.message
      )
      completionHandler(PayloadError(failure: failure))
      return
    }

    // 2. Payload-derived routing agreement (AGENTS rule #1): a payload
    //    whose sniff disagrees with its declared protocol is rejected —
    //    the module checked this too, but the extension cannot trust the
    //    hand-off's provenance.
    let sniffed = TunnelProtocolKind.detect(fromConfigText: stored.configText)
    guard sniffed == stored.protocolKind else {
      let message = "declared protocol \(stored.protocolKind.rawValue) does not match the \(sniffed.rawValue) payload"
      SharedPayload.writeProviderStatus(state: TunnelContracts.statusError, message: message)
      completionHandler(PayloadError(runtimeMessage: message))
      return
    }

    // 3. Publishing status from the extension (≤1 Hz, changed values only
    //    — validated state, so the connecting stop is legitimate).
    SharedPayload.writeProviderStatus(state: TunnelContracts.statusConnecting, message: nil)

    // 4. Real tunnel settings (never skipped — even a gated engine needs
    //    the IP topology applied so no packet leaks while diagnosing).
    let settings = buildNetworkSettings(
      dnsServers: stored.dnsServers.isEmpty ? settingsDnsFallback : stored.dnsServers
    )
    setTunnelNetworkSettings(settings) { [weak self] settingsError in
      guard let self = self else {
        completionHandler(PayloadError(runtimeMessage: "the tunnel provider is gone"))
        return
      }
      if let settingsError = settingsError {
        let message = "tunnel network settings rejected: \((settingsError as NSError).domain)"
        SharedPayload.writeProviderStatus(state: TunnelContracts.statusError, message: message)
        completionHandler(PayloadError(runtimeMessage: message))
        return
      }
      self.route(stored, completionHandler: completionHandler)
    }
  }

  /** Builds the TUN topology shared by both engines (MTU + IPv4 default
   * route + all-DNS matching + IPv6 default route). */
  private func buildNetworkSettings(dnsServers: [String]) -> NEPacketTunnelNetworkSettings {
    let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: settingsAddress)
    settings.mtu = 1420

    let ipv4 = NEIPv4Settings(addresses: [settingsAddress], subnetMasks: [settingsSubnetMask])
    ipv4.includedRoutes = [NEIPv4Route.default()]
    settings.ipv4Settings = ipv4

    // IPv6 default route — an IPv4-only relay cannot carry v6; capturing
    // it here means packets fail inside the tunnel instead of leaking.
    let ipv6 = NEIPv6Settings(addresses: ["fd00::1001"], networkPrefixLengths: [64])
    ipv6.includedRoutes = [NEIPv6Route.default()]
    settings.ipv6Settings = ipv6

    // All DNS goes through the tunnel (matchDomains [""]) — the
    // sanitized config may override servers; the fallback is only used
    // when a payload carries no DNS.
    let dns = NEDNSSettings(servers: dnsServers)
    dns.matchDomains = [""]
    settings.dnsSettings = dns

    return settings
  }

  // MARK: Engine routing (typed, plan §6 step 3)

  private func route(_ stored: TunnelHandoff, completionHandler: @escaping (Error?) -> Void) {
    // Both engines are typed-gated this phase with honest reason strings;
    // a real engine registers a concrete adapter here when it lands,
    // keeping this same start path (no invented engine object and no
    // silent success).
    let reason: String
    switch stored.protocolKind {
    case .openvpn:
      reason = TunnelContracts.openvpnEngineUnavailableReason
    case .wireguard:
      reason = TunnelContracts.wireguardEngineUnavailableReason
    }
    gate(reason, completionHandler: completionHandler)
  }

  /** Typed gate: cancels with configurationFailed and publishes the typed
   * message; the app process surfaces it through onStatusChanged. */
  private func gate(_ reason: String, completionHandler: (Error?) -> Void) {
    let message = ProviderErrorMessages.engineUnavailablePrefix + reason
    flushCounters()
    SharedPayload.writeProviderStatus(state: TunnelContracts.statusError, message: message)
    SafeLog.log("provider gated: engine unavailable (note in shared status)")
    completionHandler(PayloadError(runtimeMessage: message))
  }

  // MARK: Packet flow accounting (real, engine-independent)
  //
  // Packets read from the TUN flow travel device→tunnel (counted as
  // bytesOut); packets an engine writes into the flow travel
  // tunnel→device (counted as bytesIn). The reader loop starts on wake —
  // the first path where a live TUN can move packets — and engine
  // adapters (when they land) call flushCounters() around their own
  // write bursts. With engines gated, totals stay flat honestly: no
  // packets are being forwarded and none are counted as delivered.

  private var bytesIn: Int = 0
  private var bytesOut: Int = 0
  private var readerRunning = false

  private func startAccounting() {
    guard !readerRunning else { return }
    readerRunning = true
    readLoop()
  }

  private func readLoop() {
    guard readerRunning else { return }
    packetFlow.readPacketObjects { [weak self] packets in
      guard let self = self, self.readerRunning else { return }
      for packet in packets {
        self.bytesOut += packet.data.count
      }
      self.flushCounters()
      self.readLoop()
    }
  }

  private func flushCounters() {
    SharedPayload.writeCounters(bytesIn: Int64(bytesIn), bytesOut: Int64(bytesOut))
  }

  // MARK: Stop

  override func stopTunnel(
    with reason: NEProviderStopReason,
    completionHandler: @escaping () -> Void
  ) {
    // Stop the accounting loop, flush the final counters once, and clear
    // the shared status keys so the app cannot quote a stale failure
    // forever (plan §6 stop rules); the next start writes fresh values.
    readerRunning = false
    flushCounters()
    SharedPayload.clearProviderStatus()
    SafeLog.log("provider stopped (reason code \(reason.rawValue))")
    completionHandler()
  }

  // MARK: Sleep/wake

  override func sleep(completionHandler: @escaping () -> Void) {
    readerRunning = false
    flushCounters()
    completionHandler()
  }

  override func wake() {
    // Re-establish the accounting loop; engine reconnection belongs to the
    // engine adapters once they exist (the OS re-invokes start on needs).
    startAccounting()
  }
}

/** NSError wrapper around the payload's typed failures (extension-side). */
final class PayloadError: NSError, @unchecked Sendable {
  convenience init(failure: SharedPayload.Failure) {
    let code: Int
    switch failure {
    case .noSuite: code = 1
    case .tooLarge: code = 2
    case .missing: code = 3
    case .unreadable: code = 4
    case .stale: code = 5
    }
    self.init(domain: "OpenTunnelPacketTunnel.payload", code: code, userInfo: [
      NSLocalizedDescriptionKey: failure.message,
    ])
  }

  convenience init(runtimeMessage: String) {
    self.init(domain: "OpenTunnelPacketTunnel.runtime", code: 10, userInfo: [
      NSLocalizedDescriptionKey: runtimeMessage,
    ])
  }
}

/**
 * The extension's only logging surface — deliberately messages-free of
 * payload content (AGENTS rule #2/#5: no keys, certs, or config text EVER
 * logged; privacy by construction).
 */
enum SafeLog {
  static func log(_ message: String) {
    // os_log is available in extensions; the message is static text only.
    Foundation.NSLog("OpenTunnelPacketTunnel: %@", message)
  }
}
