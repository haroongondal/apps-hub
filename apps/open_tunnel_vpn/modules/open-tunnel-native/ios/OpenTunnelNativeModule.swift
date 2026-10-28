import ExpoModulesCore
import Foundation
import Network
import NetworkExtension
import UIKit

// MARK: - Error codes
// Contract: `OPEN_TUNNEL_ERROR_CODES` in modules/open-tunnel-native/src/index.ts.
// Mirrors the Kotlin module constants 1:1 so both platforms share taxonomy.

private enum ErrorCode {
  static let invalidConfig = "ERR_INVALID_CONFIG"
  static let invalidParams = "ERR_INVALID_PARAMS"
  static let noContext = "ERR_NO_CONTEXT"
  static let engineUnavailable = "ERR_ENGINE_UNAVAILABLE"
  static let serviceStartFailed = "ERR_SERVICE_START_FAILED"
  static let probeFailed = "ERR_PROBE_FAILED"
}

// MARK: - TunnelStateRegistry (Kotlin TunnelStateRegistry mirror)
//
// Process-wide tunnel status holder. `statusState`/`statusMessage` mirror
// the Kotlin registry; `connectedAtNanos` is the monotonic anchor of the
// current connected period (Kotlin: elapsedRealtime), null unless connected.

final class TunnelStateRegistry {
  static let shared = TunnelStateRegistry()

  private let queue = DispatchQueue(label: "expo.modules.opentunnelnative.registry")
  private var statusState = TunnelContracts.statusDisconnected
  private var statusMessage: String?
  private var connectedAtNanos: UInt64?

  struct Snapshot {
    let state: String
    let message: String?
  }

  /** Monotonic clock in nanoseconds (Uptime — wall-clock changes cannot
   * distort the connected duration, mirrors Kotlin elapsedRealtime). */
  private static func nowNanos() -> UInt64 {
    DispatchTime.now().uptimeNanoseconds
  }

  var state: String {
    queue.sync { statusState }
  }

  func snapshot() -> Snapshot {
    queue.sync { Snapshot(state: statusState, message: statusMessage) }
  }

  /** Sets the status; enforces the contract's known-state set. Returns
   * false and leaves state untouched for unknown strings (defensive). */
  @discardableResult
  func setStatus(_ state: String, _ message: String?) -> Bool {
    guard TunnelContracts.knownStatuses.contains(state) else { return false }
    queue.sync {
      statusState = state
      statusMessage = message
      connectedAtNanos = state == TunnelContracts.statusConnected ? Self.nowNanos() : nil
    }
    TunnelEventBus.shared.postStatus(state, message)
    return true
  }

  /** Connected duration in seconds from the monotonic anchor (0 unless
   * connected — the ticker duration freezes off-UP, Kotlin parity). */
  var connectedDurationSec: Int64 {
    queue.sync {
      guard let anchor = connectedAtNanos, statusState == TunnelContracts.statusConnected else {
        return 0
      }
      return Int64((Self.nowNanos() &- anchor) / 1_000_000_000)
    }
  }
}

// MARK: - TunnelEventBus (Kotlin TunnelEventBus mirror)

protocol TunnelEventListener: AnyObject {
  func onStatus(state: String, message: String?)
  func onTraffic(bytesIn: Int64, bytesOut: Int64, connectedDurationSec: Int64)
}

final class TunnelEventBus {
  static let shared = TunnelEventBus()

  private let lock = NSLock()
  private var listeners = [ObjectIdentifier: TunnelEventListener]()

  func add(_ listener: TunnelEventListener) {
    lock.lock()
    defer { lock.unlock() }
    listeners[ObjectIdentifier(listener)] = listener
  }

  /** Removes a listener by its identity (OnDestroy calls this). */
  func remove(_ listener: AnyObject) {
    lock.lock()
    defer { lock.unlock() }
    listeners.removeValue(forKey: ObjectIdentifier(listener))
  }

  /* Posts take a listener snapshot under the lock and deliver outside it so
   * a listener can synchronously call back into the bus without a deadlock. */

  func postStatus(_ state: String, _ message: String?) {
    lock.lock()
    let snapshot = Array(listeners.values)
    lock.unlock()
    for listener in snapshot {
      listener.onStatus(state: state, message: message)
    }
  }

  func postTraffic(bytesIn: Int64, bytesOut: Int64, connectedDurationSec: Int64) {
    lock.lock()
    let snapshot = Array(listeners.values)
    lock.unlock()
    for listener in snapshot {
      listener.onTraffic(bytesIn: bytesIn, bytesOut: bytesOut, connectedDurationSec: connectedDurationSec)
    }
  }
}

// MARK: - Strict config parser (Kotlin parseTunnelConfig mirror)
//
// Contract-field validation: unknown extra keys tolerated; missing/mistyped
// required fields produce the same messages as the Kotlin module so the TS
// layer sees identical wording across platforms.

struct NormalizedTunnelConfig {
  let nodeId: String
  let serverIp: String
  let serverPort: Int
  let protocolKind: TunnelProtocolKind
  /// The already-sanitized config text; handed to the engine byte-for-byte.
  let configText: String
  let dnsServers: [String]
  let enableKillSwitch: Bool
  let disallowedApps: [String]
}

enum ConfigParser {
  /** Typed parse failure (Kotlin Ok/Invalid mirror; Result's Failure must
   * conform to Swift.Error, so a bare String will not do). */
  enum Failure: Swift.Error {
    case invalid(String)
  }

  /** Extracts a boolean regardless of whether the JS path handed us Bool
   * or an NSNumber (bridged values land as NSNumber in [String: Any]). */
  private static func boolValue(_ any: Any?) -> Bool? {
    if let bool = any as? Bool { return bool }
    if let number = any as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() {
      return number.boolValue
    }
    return nil
  }

  /** Numeric paths only: a string "443" is NOT a port (typed invalid). */
  private static func intValue(_ any: Any?) -> Int? {
    guard let number = any as? NSNumber else { return nil }
    return number.intValue
  }

  static func parse(_ raw: [String: Any]) -> Result<NormalizedTunnelConfig, Failure> {
    guard let nodeId = raw["nodeId"] as? String, !nodeId.trimmingCharacters(in: .whitespaces).isEmpty else {
      return .failure(.invalid("nodeId missing"))
    }
    guard let serverIp = raw["serverIp"] as? String, !serverIp.trimmingCharacters(in: .whitespaces).isEmpty else {
      return .failure(.invalid("serverIp missing"))
    }
    guard let serverPort = intValue(raw["serverPort"]) else {
      return .failure(.invalid("serverPort missing"))
    }
    guard (1 ... 65535).contains(serverPort) else {
      return .failure(.invalid("serverPort must be 1..65535"))
    }
    guard let protocolRaw = raw["protocol"] as? String, let kind = TunnelProtocolKind(rawValue: protocolRaw) else {
      let declared = raw["protocol"] as? String ?? "missing"
      return .failure(.invalid("unknown protocol \(declared)"))
    }
    guard let configText = raw["configText"] as? String else {
      return .failure(.invalid("configText missing"))
    }
    guard !configText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return .failure(.invalid("configText empty"))
    }
    guard let dnsServers = stringList(raw, "dnsServers") else {
      return .failure(.invalid("dnsServers must be a list of strings"))
    }
    guard let enableKillSwitch = boolValue(raw["enableKillSwitch"]) else {
      return .failure(.invalid("enableKillSwitch must be boolean"))
    }
    guard let disallowedApps = stringList(raw, "disallowedApps") else {
      return .failure(.invalid("disallowedApps must be a list of strings"))
    }
    return .success(
      NormalizedTunnelConfig(
        nodeId: nodeId.trimmingCharacters(in: .whitespaces),
        serverIp: serverIp.trimmingCharacters(in: .whitespaces),
        serverPort: serverPort,
        protocolKind: kind,
        configText: configText,
        dnsServers: dnsServers,
        enableKillSwitch: enableKillSwitch,
        disallowedApps: disallowedApps
      )
    )
  }

  /** Mirrors Kotlin stringList: null when the value is not an array of
   * strings (any non-string element invalidates the whole list). */
  private static func stringList(_ raw: [String: Any], _ key: String) -> [String]? {
    guard let values = raw[key] as? [Any] else { return nil }
    var result: [String] = []
    for value in values {
      guard let string = value as? String else { return nil }
      result.append(string.trimmingCharacters(in: .whitespaces))
    }
    return result
  }
}

// MARK: - Bridge outcome

/** Typed start/stop outcome: (error code, honest message). */
enum TunnelOutcome {
  case success
  case failure(code: String, message: String)
}

/** Maps the module's normalized config onto the shared hand-off payload
 * (the shared file must stay Expo-free, so this mapping lives here). */
extension TunnelHandoff {
  init(_ config: NormalizedTunnelConfig) {
    self.init(
      protocolKind: config.protocolKind,
      configText: config.configText,
      nodeId: config.nodeId,
      serverIp: config.serverIp,
      serverPort: config.serverPort,
      dnsServers: config.dnsServers,
      enableKillSwitch: config.enableKillSwitch,
      disallowedApps: config.disallowedApps,
      writtenAtMs: Int64(Date().timeIntervalSince1970 * 1000)
    )
  }
}

// MARK: - EngineRegistry (typed availability, plan §4.3)
//
// Both engines are typed-gated this phase — the registry returns nil with
// the honest reason, which the module surfaces as ERR_ENGINE_UNAVAILABLE
// BEFORE any VPN subsystem interaction. When an engine lands, register it
// here and the rest of the flow is already real.

enum EngineRegistry {
  static func engineReason(forProtocol protocolKind: TunnelProtocolKind) -> String? {
    switch protocolKind {
    case .openvpn:
      return TunnelContracts.openvpnEngineUnavailableReason
    case .wireguard:
      return TunnelContracts.wireguardEngineUnavailableReason
    }
  }
}

// MARK: - VpnManagerBridge (module pod per the documented deviation)
//
// The command §1 placed this file in the app target (`ios/OpenTunnel/`).
// The Expo Modules API requires the module class (and its helpers) to live
// in the module pod, so the bridge lives here and the app target keeps
// only target-membership requirements (podfile-registered dependency).
//
// Flow (plan §4.3): load all preferences once → find/create the manager by
// `providerBundleIdentifier` → providerConfiguration = metadata ONLY →
// on-demand CONNECT rule when kill switch → save → reload → start.
// Save-before-start ordering (settings must be saved to preferences
// before the connection can start; the reload refreshes the manager).

final class VpnManagerBridge {
  static let shared = VpnManagerBridge()

  private let queue = DispatchQueue(label: "expo.modules.opentunnelnative.bridge")
  private var cachedManager: NETunnelProviderManager?
  private var statusToken: NSObjectProtocol?

  /** Installs the NEVPNStatusDidChange observer (idempotent). Registry +
   * bus mirror the Kotlin service-driven path: the OS connection is the
   * source of truth while the app process is alive. */
  func ensureObservers() {
    queue.async {
      guard self.statusToken == nil else { return }
      self.statusToken = NotificationCenter.default.addObserver(
        forName: .NEVPNStatusDidChange,
        object: nil,
        queue: nil
      ) { [weak self] notification in
        self?.handleStatusChange(notification)
      }
    }
  }

  deinit {
    if let token = statusToken {
      NotificationCenter.default.removeObserver(token)
    }
  }

  private func handleStatusChange(_ notification: Notification) {
    queue.async {
      guard let connection = notification.object as? NEVPNConnection,
            connection === self.cachedManager?.connection
      else {
        return
      }
      let (state, message): (String, String?) = {
        switch connection.status {
        case .invalid:
          // Not configured in the system — treat as disconnected (registry
          // state strings only know the six contract values).
          return (TunnelContracts.statusDisconnected, nil)
        case .disconnected:
          // A cancel surfaces the provider's typed error wording if one was
          // written, else plain disconnected.
          let provider = SharedPayload.readProviderStatus()
          return (
            TunnelContracts.statusDisconnected,
            provider.state == TunnelContracts.statusError ? provider.message : nil
          )
        case .connecting:
          return (TunnelContracts.statusConnecting, nil)
        case .connected:
          return (TunnelContracts.statusConnected, nil)
        case .reasserting:
          return (TunnelContracts.statusReasserting, nil)
        case .disconnecting:
          return (TunnelContracts.statusDisconnecting, nil)
        @unknown default:
          // A status the contract does not name yet — contract parity wins:
          // map to unknown-safe disconnected so no invented state can be
          // computed out of band.
          return (TunnelContracts.statusDisconnected, nil)
        }
      }()
      // Registry + bus: the whole event path (main-thread delivery is the
      // listener's own concern, mirroring Kotlin's Dispatchers.Main hop).
      TunnelStateRegistry.shared.setStatus(state, message)
    }
  }

  // MARK: Start

  /** Full real start flow; every step typed. Called only after the caller
   * passed the EngineRegistry gate, but it still fails typed if the
   * subsystem disagrees, never faking success. */
  func start(config: NormalizedTunnelConfig, completion: @escaping (TunnelOutcome) -> Void) {
    // 1. Hand-off payload first so the extension can read whatever it gets
    //    started with (the OS may start the extension asynchronously).
    if let failure = SharedPayload.writeActiveConfig(TunnelHandoff(config)) {
      completion(.failure(code: ErrorCode.invalidConfig, message: failure.message))
      return
    }

    // 2. Configuring = connecting (the extension republishes its own
    //    status from inside the extension process).
    TunnelStateRegistry.shared.setStatus(TunnelContracts.statusConnecting, nil)

    // 3. Load-or-create the tunnel manager (save → reload → start below).
    NETunnelProviderManager.loadAllFromPreferences { managers, error in
      if let error = error {
        TunnelStateRegistry.shared.setStatus(
          TunnelContracts.statusDisconnected,
          nil
        )
        completion(.failure(
          code: ErrorCode.serviceStartFailed,
          message: "VPN preferences load failed: \((error as NSError).domain)"
        ))
        return
      }

      let bundleId = TunnelContracts.providerBundleIdentifier
      let existing = managers?.first { manager in
        (manager.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == bundleId
      }
      let manager = existing ?? NETunnelProviderManager()

      // Metadata only in providerConfiguration — never the config text
      // or any key material (privacy rule #5).
      let protocolConfig = NETunnelProviderProtocol()
      protocolConfig.providerBundleIdentifier = bundleId
      protocolConfig.serverAddress = config.serverIp
      protocolConfig.providerConfiguration = [
        "protocol": config.protocolKind.rawValue,
        "nodeId": config.nodeId,
        "updatedAtMs": Int(Date().timeIntervalSince1970 * 1000),
      ]
      manager.protocolConfiguration = protocolConfig
      manager.localizedDescription = "OpenTunnel"
      manager.isEnabled = true

      // Kill switch: on-demand CONNECT keeps the tunnel up whenever the
      // system opens a connection (AGENTS rule #3). The Android-only
      // packet-bypass API is never used, here or anywhere.
      if config.enableKillSwitch {
        manager.onDemandRules = [NEOnDemandRuleConnect()]
      } else {
        manager.onDemandRules = []
      }
      manager.isOnDemandEnabled = config.enableKillSwitch

      manager.saveToPreferences { saveError in
        if let saveError = saveError {
          TunnelStateRegistry.shared.setStatus(TunnelContracts.statusDisconnected, nil)
          completion(.failure(
            code: ErrorCode.serviceStartFailed,
            message: "VPN configuration save failed: \((saveError as NSError).domain)"
          ))
          return
        }

        // The manager instance must be reloaded after saving before its
        // connection can be started (Apple's required ordering).
        manager.loadFromPreferences { reloadError in
          if let reloadError = reloadError {
            TunnelStateRegistry.shared.setStatus(TunnelContracts.statusDisconnected, nil)
            completion(.failure(
              code: ErrorCode.serviceStartFailed,
              message: "VPN configuration reload failed: \((reloadError as NSError).domain)"
            ))
            return
          }

          self.queue.sync { self.cachedManager = manager }

          do {
            try manager.connection.startVPNTunnel()
            completion(.success)
          } catch {
            TunnelStateRegistry.shared.setStatus(TunnelContracts.statusDisconnected, nil)
            completion(.failure(
              code: ErrorCode.serviceStartFailed,
              message: "VPN tunnel start failed: \((error as NSError).domain)"
            ))
          }
        }
      }
    }
  }

  // MARK: Stop

  /** Mirrors the Kotlin stop: status first, then the OS stop. When no
   * manager exists yet the tunnel is already off — success (resolve).
   * Payload release rule (plan §5): with Always-On on-demand OFF the
   * hand-off is released on stop; with the kill switch ON the payload
   * survives so an OS-triggered reconnect always finds a config — the
   * payload is never the raw VPN Gate row. */
  func stop(completion: @escaping (TunnelOutcome) -> Void) {
    TunnelStateRegistry.shared.setStatus(TunnelContracts.statusDisconnecting, nil)
    queue.async {
      if let manager = self.cachedManager {
        manager.connection.stopVPNTunnel()
      }
      // Read back the kill-switch posture for the release decision.
      switch SharedPayload.readActiveConfig() {
      case let .success(handoff) where !handoff.enableKillSwitch:
        SharedPayload.clearActiveConfig()
      case .success, .failure:
        break
      }
      completion(.success)
    }
  }

  // MARK: Status

  /** Real NEVPNStatus mapping; the OS-reported state is authoritative, the
   * registry is the fallback when no manager is loaded. App process restarts
   * re-converge because a loaded manager's connection reports its current
   * status immediately. */
  func statusMapping(completion: @escaping (String) -> Void) {
    queue.async {
      guard let manager = self.cachedManager else {
        completion(TunnelStateRegistry.shared.state)
        return
      }
      let mapped = Self.string(for: manager.connection.status)
      completion(mapped ?? TunnelStateRegistry.shared.state)
    }
  }

  /** Cold bridge (app process restart while a tunnel lives outside this
   * process): load the manager, read its CURRENT connection status (the
   * OS-reported state is authoritative), and reconcile the registry —
   * never force a state. The ticker re-seeds when the state is connected
   * so no stale counter deltas pollute the first tick. */
  func refreshCachedManager() {
    queue.async {
      guard self.cachedManager == nil else { return }
      NETunnelProviderManager.loadAllFromPreferences { managers, _ in
        let bundleId = TunnelContracts.providerBundleIdentifier
        guard let manager = managers?.first(where: {
          ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == bundleId
        }) else {
          return
        }
        manager.loadFromPreferences { _ in
          self.queue.sync { self.cachedManager = manager }
          guard let mapped = Self.string(for: manager.connection.status) else { return }
          let previous = TunnelStateRegistry.shared.state
          TunnelStateRegistry.shared.setStatus(mapped, nil)
          if mapped == TunnelContracts.statusConnected, previous != mapped {
            TrafficTicker.shared.reseed()
          }
        }
      }
    }
  }

  private static func string(for status: NEVPNStatus) -> String? {
    switch status {
    case .invalid: return TunnelContracts.statusDisconnected
    case .disconnected: return TunnelContracts.statusDisconnected
    case .connecting: return TunnelContracts.statusConnecting
    case .connected: return TunnelContracts.statusConnected
    case .reasserting: return TunnelContracts.statusReasserting
    case .disconnecting: return TunnelContracts.statusDisconnecting
    @unknown default: return nil
    }
  }
}

// MARK: - TrafficTicker (module-owned cadence, plan §6)
//
// ≤1 Hz, scheduled on the main dispatch queue. Reads the provider's
// cumulative counters from the App Group, emits DELTAS (Kotlin parity with
// TrafficStats deltas), and posts only while the registry reports
// `connected` — the duration freezes off-UP as well. Baselines re-seed on
// every connected transition so the first tick of a period is a real delta.

final class TrafficTicker {
  static let shared = TrafficTicker()

  private let lock = NSLock()
  private var timer: DispatchSourceTimer?
  private var lastBytesIn: Int64 = 0
  private var lastBytesOut: Int64 = 0
  private var didSeed = false

  func start() {
    lock.lock()
    defer { lock.unlock() }
    guard timer == nil else { return }
    reseedLocked()
    let source = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
    source.schedule(deadline: .now(), repeating: .seconds(1))
    source.setEventHandler { [weak self] in self?.tick() }
    source.resume()
    timer = source
  }

  func stop() {
    lock.lock()
    defer { lock.unlock() }
    timer?.cancel()
    timer = nil
  }

  func reseed() {
    lock.lock()
    defer { lock.unlock() }
    reseedLocked()
  }

  private func reseedLocked() {
    let counters = SharedPayload.readCounters()
    lastBytesIn = counters.bytesIn
    lastBytesOut = counters.bytesOut
    didSeed = true
  }

  private func tick() {
    lock.lock()
    defer { lock.unlock() }
    guard didSeed, timer != nil else { return }
    let counters = SharedPayload.readCounters()
    let deltaIn = max(0, counters.bytesIn &- lastBytesIn)
    let deltaOut = max(0, counters.bytesOut &- lastBytesOut)
    lastBytesIn = counters.bytesIn
    lastBytesOut = counters.bytesOut
    guard TunnelStateRegistry.shared.state == TunnelContracts.statusConnected else { return }
    TunnelEventBus.shared.postTraffic(
      bytesIn: deltaIn,
      bytesOut: deltaOut,
      connectedDurationSec: TunnelStateRegistry.shared.connectedDurationSec
    )
  }
}

// MARK: - NativeTcpProbe (Kotlin NativeTcpProbe mirror)
//
// Unlike NetLens host discovery, a refused connect means the relay's VPN
// port is closed, so it reports no measurement, like timeouts and
// unroutable paths. One bounded connect; destroyed on every path.

enum NativeTcpProbe {
  /** Bounded single-connect measurement (ms) or nil without a measurement. */
  static func measure(
    host rawHost: String,
    port: Int,
    timeoutMs: Int,
    completion: @escaping (Double?) -> Void
  ) {
    let queue = DispatchQueue(label: "expo.modules.opentunnelnative.probe")
    let host = NWEndpoint.Host(rawHost)
    guard let portValue = NWEndpoint.Port(rawValue: UInt16(clamping: port)) else {
      completion(nil)
      return
    }
    let connection = NWConnection(host: host, port: portValue, using: .tcp)
    let startedAt = DispatchTime.now()

    let lock = NSLock()
    var finished = false

    func finish(_ ms: Double?) {
      lock.lock()
      let alreadyDone = finished
      finished = true
      lock.unlock()
      connection.cancel()
      guard !alreadyDone else { return }
      completion(ms)
    }

    func elapsedMs() -> Double {
      Double((DispatchTime.now().uptimeNanoseconds &- startedAt.uptimeNanoseconds)) / 1_000_000
    }

    connection.stateUpdateHandler = { state in
      switch state {
      case .ready:
        finish(elapsedMs())
      case .failed, .cancelled:
        // The caller keeps the static CSV ping as fallback.
        finish(nil)
      default:
        break // .waiting stays inside the deadline window
      }
    }

    connection.start(queue: queue)

    let deadline: DispatchTime = DispatchTime.now() + .milliseconds(timeoutMs)
    queue.asyncAfter(deadline: deadline) {
      finish(nil)
    }
  }
}

// MARK: - Module

/** Delivers registry/bus events to JS on the main thread (Kotlin module
 * posts via Dispatchers.Main; Expo sendEvent schedules on the JS runtime
 * internally). Also re-seeds the traffic baselines on connected
 * transitions (Kotlin TrafficTicker.start() re-seeds on every connect). */
private final class ModuleEventForwarder: TunnelEventListener {
  private weak var module: OpenTunnelNativeModule?
  private var wasConnected = false

  init(module: OpenTunnelNativeModule) {
    self.module = module
  }

  func onStatus(state: String, message: String?) {
    let nowConnected = state == TunnelContracts.statusConnected
    if nowConnected && !wasConnected {
      TrafficTicker.shared.reseed()
    }
    wasConnected = nowConnected
    DispatchQueue.main.async {
      self.module?.sendEvent("onStatusChanged", ["state": state, "message": message])
    }
  }

  func onTraffic(bytesIn: Int64, bytesOut: Int64, connectedDurationSec: Int64) {
    DispatchQueue.main.async {
      self.module?.sendEvent("onTrafficUpdate", [
        "bytesIn": bytesIn,
        "bytesOut": bytesOut,
        "connectedDurationSec": connectedDurationSec,
      ])
    }
  }
}

public class OpenTunnelNativeModule: Module {
  private var forwarder: ModuleEventForwarder?

  public func definition() -> ModuleDefinition {
    Name("OpenTunnelNative")

    Events("onStatusChanged", "onTrafficUpdate")

    OnStartObserving {
      let forwarder = ModuleEventForwarder(module: self)
      self.forwarder = forwarder
      TunnelEventBus.shared.add(forwarder)
      VpnManagerBridge.shared.ensureObservers()
      // A tunnel may already run (app restart): the bridge reconciles the
      // registry with the persisted manager's real OS-reported status.
      VpnManagerBridge.shared.refreshCachedManager()
      TrafficTicker.shared.start()
    }

    OnDestroy {
      TrafficTicker.shared.stop()
      if let forwarder = forwarder {
        TunnelEventBus.shared.remove(forwarder)
      }
      self.forwarder = nil
    }

    /**
     * Hand-off tunnel start (plan §4.3): validate, route by payload sniff,
     * gate the engine registry typed, then run the real NETunnelProvider
     * flow. Resolves once handed to the OS (VPNTunnel started), not once
     * traffic flows — mirrors the Kotlin "resolves once handed to the
     * service" contract.
     */
    AsyncFunction("startTunnel") { (config: [String: Any], promise: Promise) in
      let normalized: NormalizedTunnelConfig
      switch ConfigParser.parse(config) {
      case let .failure(.invalid(message)):
        promise.reject(ErrorCode.invalidConfig, message)
        return
      case let .success(parsed):
        normalized = parsed
      }

      // Payload routing is sniff-derived (AGENTS rule #1): declared and
      // sniffed cannot disagree (mirrors Kotlin VpnPayload check).
      let sniffed = TunnelProtocolKind.detect(fromConfigText: normalized.configText)
      guard sniffed == normalized.protocolKind else {
        promise.reject(
          ErrorCode.invalidConfig,
          "declared protocol \(normalized.protocolKind.rawValue) does not match the \(sniffed.rawValue) payload"
        )
        return
      }

      // Typed engine gate BEFORE any VPN subsystem interaction. When an
      // engine registers, this check passes and the bridge flow runs.
      if let reason = EngineRegistry.engineReason(forProtocol: normalized.protocolKind) {
        promise.reject(ErrorCode.engineUnavailable, reason)
        return
      }

      VpnManagerBridge.shared.start(config: normalized) { outcome in
        switch outcome {
        case .success:
          promise.resolve(nil)
        case let .failure(code, message):
          promise.reject(code, message)
        }
      }
    }

    /** Status first (disconnecting), then the OS stop — Kotlin parity. */
    AsyncFunction("stopTunnel") { (promise: Promise) in
      VpnManagerBridge.shared.stop { outcome in
        switch outcome {
        case .success:
          promise.resolve(nil)
        case let .failure(code, message):
          promise.reject(code, message)
        }
      }
    }

    /** Real NEVPNStatus mapping (no cached guess), registry fallback. */
    AsyncFunction("getState") { (promise: Promise) in
      VpnManagerBridge.shared.statusMapping { state in
        promise.resolve(state)
      }
    }

    /**
     * iOS has no ACTION_VPN_SETTINGS equivalent for the VPN sheet — the
     * app settings page (openSettingsURLString) is the app's lever; the
     * always-on/blockers surfacing is phase-4 polish. Resolves whether the
     * settings page actually opened.
     */
    AsyncFunction("openSystemVpnSettings") { (promise: Promise) in
      guard self.appContext != nil else {
        promise.reject(ErrorCode.noContext, "React context unavailable")
        return
      }
      DispatchQueue.main.async {
        guard let url = URL(string: UIApplication.openSettingsURLString) else {
          promise.resolve(false)
          return
        }
        UIApplication.shared.open(url, options: [:]) { opened in
          promise.resolve(opened)
        }
      }
    }

    /**
     * Bounded single-connect probe (plan §4.4, Android parity). Validation
     * ranges are identical; the RTT is measured in ms for an open connect;
     * refused/timeouts/unroutable resolve null (the JS layer keeps the static
     * CSV ping as fitness fallback).
     */
    AsyncFunction("tcpProbe") { (ip: String, port: Int, timeoutMs: Int, promise: Promise) in
      guard (1 ... 65535).contains(port) else {
        promise.reject(ErrorCode.invalidParams, "port must be 1..65535")
        return
      }
      guard (1 ... 15000).contains(timeoutMs) else {
        promise.reject(ErrorCode.invalidParams, "timeoutMs must be 1..15000")
        return
      }
      NativeTcpProbe.measure(
        host: ip.trimmingCharacters(in: .whitespaces),
        port: port,
        timeoutMs: timeoutMs
      ) { rttMs in
        // resolve(number) or resolve(null): mirrors Kotlin resolve(rttMs)
        // where null means no measurement (the JS binding maps null to null).
        promise.resolve(rttMs.map { NSNumber(value: $0) })
      }
    }
  }
}
