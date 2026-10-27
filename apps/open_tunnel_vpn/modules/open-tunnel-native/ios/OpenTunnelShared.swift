import Foundation

/**
 * OpenTunnel tunnel contracts shared by every native reader of the
 * App-Group hand-off. Compiled into:
 *   - the OpenTunnelNative Expo module pod (app process), and
 *   - the OpenTunnelPacketTunnel Network Extension.
 * One source of truth so the writer (module) and the reader (extension)
 * cannot drift. Contains no Expo imports — the extension must stay
 * Expo-free — and never handles config/key material outside the
 * documented payload fields.
 *
 * Contract mirrors (AGENTS rule #1): `detectProtocol` is 1:1 with
 * open-tunnel-core `detectVpnProtocol`
 * (packages/open-tunnel-core/src/vpngate.ts) and the Kotlin
 * `VpnPayload.detectProtocol`, so JS and every native layer sniff the
 * same way.
 */
public enum TunnelContracts {
  // MARK: Identity

  /** App Group holding the single active tunnel hand-off. */
  public static let appGroupSuite = "group.com.opentunnel.vpn"

  /** Bundle id of the packet-tunnel extension (must stay prefixed by the
   * app's bundle id `com.opentunnel.openTunnelVpn`). */
  public static let providerBundleIdentifier = "com.opentunnel.openTunnelVpn.PacketTunnel"

  // MARK: App-Group keys

  /** The single active config hand-off (JSON string, plan §5). */
  public static let activeConfigKey = "activeConfig"

  /** Provider-published status strings (≤1 Hz, values only when changed). */
  public static let providerStatusStateKey = "provider.status.state"
  public static let providerStatusMessageKey = "provider.status.message"

  /** Provider-published cumulative counters (bytes, extension-owned totals). */
  public static let providerTrafficBytesInKey = "provider.traffic.bytesIn"
  public static let providerTrafficBytesOutKey = "provider.traffic.bytesOut"

  // MARK: Payload guards (plan §5)

  /** Reject payloads larger than this on read AND write (extension memory
   * ceiling guard; the sanitized VPN Gate config is ~2-8 KB). */
  public static let payloadSizeLimitBytes = 256 * 1024

  /** Staleness guard: payload older than this is not trusted for a start. */
  public static let payloadMaxAgeMs: Int = 10 * 60 * 1000

  // MARK: Status strings (TS `VpnStatusState` / TunnelStateRegistry mirror)

  public static let statusDisconnected = "disconnected"
  public static let statusConnecting = "connecting"
  public static let statusConnected = "connected"
  public static let statusDisconnecting = "disconnecting"
  public static let statusReasserting = "reasserting"
  public static let statusError = "error"

  public static let knownStatuses: Set<String> = [
    statusDisconnected, statusConnecting, statusConnected,
    statusDisconnecting, statusReasserting, statusError,
  ]

  // MARK: Engine gates (typed, honest — the engines are not yet available)

  /** G1: OpenVPN on iOS stays gated pending the GPLv2 carry-in decision. */
  public static let openvpnEngineUnavailableReason =
    "openvpn engine unavailable on iOS: ics-openvpn port is gated pending the GPLv2 license decision (G1)"

  /** G2: wireguard-go bridge ships via an external Go build; SwiftPM cannot
   * build it, and this machine has no Go toolchain (recorded blocker). */
  public static let wireguardEngineUnavailableReason =
    "wireguard engine unavailable on iOS: the WireGuardKit wireguard-go bridge needs an external Go build and no Go toolchain is present (G2 blocker)"

}

/**
 * Payload-derived protocol routing — the Swift sniff copy shared by the
 * module and the extension. WireGuard payloads declare `[Interface]` +
 * `PrivateKey`; VPN Gate payloads are OpenVPN even when a row lacks the
 * `client` keyword (`<ca>` or a `proto` line).
 */
public enum TunnelProtocolKind: String {
  case openvpn
  case wireguard

  public static func detect(fromConfigText configText: String) -> TunnelProtocolKind {
    let lower = configText.lowercased()
    if lower.contains("[interface]") && lower.contains("privatekey") {
      return .wireguard
    }
    let protoLine = try? NSRegularExpression(
      pattern: "^\\s*proto\\s+(?:tcp4?|tcp6|tcp|udp4?|udp6|udp)\\b",
      options: [.caseInsensitive, .anchorsMatchLines]
    )
    let range = NSRange(configText.startIndex ..< configText.endIndex, in: configText)
    let hasProtoLine = protoLine?.firstMatch(in: configText, range: range) != nil
    if lower.contains("<ca>") || hasProtoLine {
      return .openvpn
    }
    return .wireguard
  }
}

// MARK: - Hand-off payload (plan §5, single source of truth)
//
// The single active config hand-off written by the module on
// startTunnel(config) and read by the extension at startTunnel. It carries
// the already-sanitized payload plus the fields both sides need; the raw
// VPN Gate row never crosses the boundary (AGENTS rule #2).

public struct TunnelHandoff {
  public let protocolKind: TunnelProtocolKind
  /// Already-sanitized config text, byte-for-byte (validator output).
  public let configText: String
  /// 64-char hash id — traceability without PII.
  public let nodeId: String
  public let serverIp: String
  public let serverPort: Int
  public let dnsServers: [String]
  public let enableKillSwitch: Bool
  public let disallowedApps: [String]
  /// Wall-clock write time (ms) for the staleness guard.
  public let writtenAtMs: Int64

  public init(
    protocolKind: TunnelProtocolKind,
    configText: String,
    nodeId: String,
    serverIp: String,
    serverPort: Int,
    dnsServers: [String],
    enableKillSwitch: Bool,
    disallowedApps: [String],
    writtenAtMs: Int64
  ) {
    self.protocolKind = protocolKind
    self.configText = configText
    self.nodeId = nodeId
    self.serverIp = serverIp
    self.serverPort = serverPort
    self.dnsServers = dnsServers
    self.enableKillSwitch = enableKillSwitch
    self.disallowedApps = disallowedApps
    self.writtenAtMs = writtenAtMs
  }
}

// MARK: - SharedPayload (App-Group writer/reader, plan §5)
//
// Container choice (documented decision): UserDefaults(suiteName:) for
// everything — the config JSON, provider status, counters. No base64
// double-churn, atomic cross-process replaces, no extra file management.
// Size guard on write AND read: reject > 256 KB with a typed error.
// Staleness guard on read: payload older than payloadMaxAgeMs is stale.

public enum SharedPayload {
  /** Typed failure messages; callers surface them verbatim (never logged
   * content). Extension callers cancel with these words too. */
  public enum Failure: Swift.Error {
    case noSuite
    case tooLarge
    case missing
    case unreadable
    case stale

    public var message: String {
      switch self {
      case .noSuite:
        return "the \(TunnelContracts.appGroupSuite) App Group is not readable from this process"
      case .tooLarge:
        return "the active config exceeds the 256 KB App-Group payload guard"
      case .missing:
        return "no active tunnel config in the shared App Group"
      case .unreadable:
        return "the shared config payload is not decodable"
      case .stale:
        return "the shared config payload is stale (older than 10 minutes)"
      }
    }
  }

  private static func suite() -> UserDefaults? {
    UserDefaults(suiteName: TunnelContracts.appGroupSuite)
  }

  // MARK: JSON serialization (no base64 double-churn; sorted keys so the
  // written form is deterministic for debugging)

  private static func handoffJson(_ handoff: TunnelHandoff) throws -> Data {
    let dict: [String: Any] = [
      "protocol": handoff.protocolKind.rawValue,
      "configText": handoff.configText,
      "nodeId": handoff.nodeId,
      "serverIp": handoff.serverIp,
      "serverPort": handoff.serverPort,
      "dnsServers": handoff.dnsServers,
      "enableKillSwitch": handoff.enableKillSwitch,
      "disallowedApps": handoff.disallowedApps,
      "writtenAtMs": handoff.writtenAtMs,
    ]
    return try JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys])
  }

  // MARK: Writer side (module, on startTunnel)

  /** Writes the single active hand-off. Fails typed on oversize — the
   * config never rides providerConfiguration or any other persistent
   * store (privacy rule #5). */
  @discardableResult
  public static func writeActiveConfig(_ handoff: TunnelHandoff) -> Failure? {
    guard let defaults = suite() else { return .noSuite }
    let data: Data
    do {
      data = try handoffJson(handoff)
    } catch {
      return .unreadable
    }
    guard data.count <= TunnelContracts.payloadSizeLimitBytes else { return .tooLarge }
    defaults.set(String(decoding: data, as: UTF8.self), forKey: TunnelContracts.activeConfigKey)
    defaults.synchronize()
    return nil
  }

  /** Release path: removes the hand-off (stop with Always-On off; iOS
   * keeps it otherwise — plan §5 "keep the payload, never the row"). */
  public static func clearActiveConfig() {
    suite()?.removeObject(forKey: TunnelContracts.activeConfigKey)
    suite()?.synchronize()
  }

  // MARK: Reader side (provider payload)

  /** Size + staleness + required-keys guard, typed. The extension never
   * reads anything else from the suite. */
  public static func readActiveConfig(
    nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
  ) -> Result<TunnelHandoff, Failure> {
    guard let defaults = suite() else { return .failure(.noSuite) }
    guard let raw = defaults.string(forKey: TunnelContracts.activeConfigKey) else {
      return .failure(.missing)
    }
    let data = Data(raw.utf8)
    guard data.count <= TunnelContracts.payloadSizeLimitBytes else { return .failure(.tooLarge) }
    guard let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      return .failure(.unreadable)
    }
    guard let protocolRaw = dict["protocol"] as? String,
          let kind = TunnelProtocolKind(rawValue: protocolRaw),
          let configText = dict["configText"] as? String, !configText.isEmpty,
          let nodeId = dict["nodeId"] as? String,
          let serverIp = dict["serverIp"] as? String,
          let port = dict["serverPort"] as? Int,
          (1 ... 65535).contains(port),
          let dns = dict["dnsServers"] as? [String],
          let killSwitch = dict["enableKillSwitch"] as? Bool
              ?? (dict["enableKillSwitch"] as? NSNumber)?.boolValue
    else {
      return .failure(.unreadable)
    }
    guard let writtenAtMs = dict["writtenAtMs"] as? Int64,
          (nowMs - writtenAtMs) <= TunnelContracts.payloadMaxAgeMs
    else {
      return .failure(.stale)
    }
    return .success(
      TunnelHandoff(
        protocolKind: kind,
        configText: configText,
        nodeId: nodeId,
        serverIp: serverIp,
        serverPort: port,
        dnsServers: dns,
        enableKillSwitch: killSwitch,
        disallowedApps: (dict["disallowedApps"] as? [String]) ?? [],
        writtenAtMs: writtenAtMs
      )
    )
  }

  // MARK: Provider status/counters (both sides)

  /** Provider status write. The module learns about changes through its
   * 1 Hz ticker and NEVPNStatusDidChange — ≤1 Hz cadence with values
   * published only when they change, per plan §6. */
  public static func writeProviderStatus(state: String, message: String?) {
    let defaults = suite()
    defaults?.set(state, forKey: TunnelContracts.providerStatusStateKey)
    defaults?.set(message, forKey: TunnelContracts.providerStatusMessageKey)
    defaults?.synchronize()
  }

  public static func readProviderStatus() -> (state: String?, message: String?) {
    let defaults = suite()
    return (defaults?.string(forKey: TunnelContracts.providerStatusStateKey),
            defaults?.string(forKey: TunnelContracts.providerStatusMessageKey))
  }

  public static func clearProviderStatus() {
    let defaults = suite()
    defaults?.removeObject(forKey: TunnelContracts.providerStatusStateKey)
    defaults?.removeObject(forKey: TunnelContracts.providerStatusMessageKey)
    defaults?.synchronize()
  }

  /** Cumulative byte counters written by the extension (module owns cadence). */
  public static func readCounters() -> (bytesIn: Int64, bytesOut: Int64) {
    let defaults = suite()
    let bytesIn = defaults?.integer(forKey: TunnelContracts.providerTrafficBytesInKey) ?? 0
    let bytesOut = defaults?.integer(forKey: TunnelContracts.providerTrafficBytesOutKey) ?? 0
    return (Int64(bytesIn), Int64(bytesOut))
  }

  public static func writeCounters(bytesIn: Int64, bytesOut: Int64) {
    let defaults = suite()
    defaults?.set(Int(truncatingIfNeeded: bytesIn), forKey: TunnelContracts.providerTrafficBytesInKey)
    defaults?.set(Int(truncatingIfNeeded: bytesOut), forKey: TunnelContracts.providerTrafficBytesOutKey)
    defaults?.synchronize()
  }
}
