import ExpoModulesCore
import Darwin

// MARK: - Domain types (mirror @apps-hub/core payloads exactly)

enum ProbeOutcome: String {
  case open
  case refused
  case timeout
  case unreachable
}

struct TcpProbeResult {
  let outcome: ProbeOutcome
  let elapsedMs: Double?
  let port: Int?
}

let defaultProbePorts: [Int] = [80, 443, 22, 445, 5353, 8080, 62078]

// MARK: - Shared cursor (locked counters: index + found hosts)

final class SweepCursor {
  private let lock = NSLock()
  private var nextIndex = 0
  private var foundCount = 0

  func nextIndex(limit: Int) -> Int? {
    lock.lock()
    defer { lock.unlock() }
    guard nextIndex < limit else { return nil }
    defer { nextIndex += 1 }
    return nextIndex
  }

  func recordFound() {
    lock.lock()
    foundCount += 1
    lock.unlock()
  }

  var found: Int {
    lock.lock()
    defer { lock.unlock() }
    return foundCount
  }
}

// MARK: - POSIX TCP probe (hard rule #2: ECONNREFUSED ⇒ RST ⇒ alive)

enum TcpProbeEngine {
  /** Non-blocking asyncio connect() + poll() + getsockopt(SO_ERROR). */
  static func probe(host ip: String, port: Int, timeoutMs: Int) -> TcpProbeResult {
    let startedAt = DispatchTime.now()

    let fd = Darwin.socket(AF_INET, SOCK_STREAM, 0)
    guard fd >= 0 else {
      return TcpProbeResult(outcome: .unreachable, elapsedMs: nil, port: port)
    }
    defer { Darwin.close(fd) }

    let currentFlags = fcntl(fd, F_GETFL, 0)
    _ = fcntl(fd, F_SETFL, currentFlags | O_NONBLOCK)

    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = in_port_t(UInt16(port & 0xFFFF).bigEndian)
    var sinAddr = in_addr()
    inet_pton(AF_INET, ip, &sinAddr)
    addr.sin_addr = sinAddr

    let connectResult = withUnsafePointer(to: &addr) { pointer -> Int32 in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
        Darwin.connect(fd, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }

    if connectResult == 0 {
      return TcpProbeResult(outcome: .open, elapsedMs: elapsedMsSince(startedAt), port: port)
    }

    let connectErrno = errno
    if connectErrno != EINPROGRESS {
      return TcpProbeResult(
        outcome: classifyErrno(connectErrno),
        elapsedMs: connectErrno == ECONNREFUSED ? elapsedMsSince(startedAt) : nil,
        port: port,
      )
    }

    // poll() until outcome or timeout
    var pollDescriptor = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
    let pollResult = Darwin.poll(&pollDescriptor, 1, CInt(timeoutMs))
    if pollResult == 0 {
      return TcpProbeResult(outcome: .timeout, elapsedMs: nil, port: port)
    }
    if pollResult < 0 {
      return TcpProbeResult(
        outcome: classifyErrno(errno),
        elapsedMs: errno == ECONNREFUSED ? elapsedMsSince(startedAt) : nil,
        port: port,
      )
    }

    var soError: Int32 = 0
    var soErrorLength = socklen_t(MemoryLayout<Int32>.size)
    getsockopt(fd, SOL_SOCKET, SO_ERROR, &soError, &soErrorLength)
    let outcome: ProbeOutcome = soError == 0 ? .open : classifyErrno(soError)
    return TcpProbeResult(
      outcome: outcome,
      elapsedMs: (outcome == .open || outcome == .refused) ? elapsedMsSince(startedAt) : nil,
      port: port,
    )
  }

  static func isReachable(_ outcome: ProbeOutcome) -> Bool {
    outcome == .open || outcome == .refused
  }

  /// HARD RULE (AGENTS.md #2): ECONNREFUSED = TCP RST from a live host.
  static func classifyErrno(_ code: Int32) -> ProbeOutcome {
    switch code {
    case ECONNREFUSED:
      return .refused
    case ETIMEDOUT:
      return .timeout
    case EHOSTUNREACH, ENETUNREACH, ENETDOWN, ENETRESET:
      return .unreachable
    default:
      return .unreachable
    }
  }

  private static func elapsedMsSince(_ startedAt: DispatchTime) -> Double {
    Double(DispatchTime.now().uptimeNanoseconds - startedAt.uptimeNanoseconds) / 1_000_000.0
  }
}

// MARK: - Module

public class NetlensCoreModule: Module {
  private let moduleLock = NSLock()
  private var tcpScanStopRequested = false
  private var tcpScanRunning = false
  private var serviceStopRequested = false

  public func definition() -> ModuleDefinition {
    Name("NetLensCore")

    Events(
      "onHostDiscovered",
      "onScanComplete",
      "onServiceDiscovered",
      "onServiceScanComplete"
    )

    AsyncFunction("getNetworkInterfaceInfo") { (promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        let info = NetworkInterfaceDetector.detectActiveInterface(interfaceName: "en0")
        if let info {
          promise.resolve([
            "localIp": info.localIp,
            "cidrPrefix": info.cidrPrefix,
            "gatewayIp": info.gatewayIp.map { $0 as Any } ?? NSNull() as Any,
          ])
        } else {
          promise.resolve(NSNull())
        }
      }
    }

    AsyncFunction("startTcpScan") { (hostIps: [String], ports: [Int], timeoutMs: Int, promise: Promise) in
      self.moduleLock.lock()
      let alreadyRunning = self.tcpScanRunning
      if !alreadyRunning {
        self.tcpScanRunning = true
        self.tcpScanStopRequested = false
      }
      self.moduleLock.unlock()

      if alreadyRunning {
        promise.reject("SCAN_IN_PROGRESS", "A TCP scan is already running")
        return
      }

      let effectivePorts = ports.isEmpty ? defaultProbePorts : ports
      let startedAt = DispatchTime.now()

      DispatchQueue.global(qos: .userInitiated).async { [weak self] in
        guard let self else {
          promise.reject("MODULE_UNAVAILABLE", "Module deallocated")
          return
        }
        // Hard rule #3: bounded concurrency — at most 64 simultaneous probes.
        let cursor = SweepCursor()
        let workerCount = min(max(1, hostIps.count), 64)
        let group = DispatchGroup()

        for workerIndex in 0..<workerCount {
          let workerQueue = DispatchQueue(
            label: "app.netlens.tcp.worker.\(workerIndex)",
            qos: .userInitiated
          )
          group.enter()
          workerQueue.async {
            while let index = cursor.nextIndex(limit: hostIps.count) {
              var stopRequested = false
              self.moduleLock.lock()
              stopRequested = self.tcpScanStopRequested
              self.moduleLock.unlock()
              if stopRequested { break }

              let ip = hostIps[index]
              for port in effectivePorts {
                let result = TcpProbeEngine.probe(host: ip, port: port, timeoutMs: timeoutMs)
                if TcpProbeEngine.isReachable(result.outcome) {
                  cursor.recordFound()
                  let payload: [String: Any] = [
                    "ip": ip,
                    "isReachable": true,
                    "rttMs": result.elapsedMs.map { Double($0) } ?? NSNull(),
                    "winningPort": result.port ?? NSNull(),
                    "outcome": result.outcome.rawValue,
                  ]
                  DispatchQueue.main.async {
                    self.sendEvent("onHostDiscovered", payload)
                  }
                  break // first responsive port wins in Phase 1
                }
              }
            }
            group.leave()
          }
        }
        group.wait()

        let durationMs = Double(
          DispatchTime.now().uptimeNanoseconds - startedAt.uptimeNanoseconds
        ) / 1_000_000.0
        var stopRequested = false
        self.moduleLock.lock()
        stopRequested = self.tcpScanStopRequested
        self.tcpScanRunning = false
        self.moduleLock.unlock()

        let completePayload: [String: Any] = [
          "durationMs": durationMs,
          "totalProbed": hostIps.count,
          "hostsFound": stopRequested ? NSNull() : cursor.found,
          "cancelled": stopRequested,
        ]
        DispatchQueue.main.async {
          self.sendEvent("onScanComplete", completePayload)
          promise.resolve(true)
        }
      }
    }

    AsyncFunction("stopTcpScan") { (promise: Promise) in
      self.moduleLock.lock()
      self.tcpScanStopRequested = true
      self.moduleLock.unlock()
      promise.resolve(true)
    }

    AsyncFunction("startServiceDiscovery") { (timeoutMs: Int, promise: Promise) in
      self.moduleLock.lock()
      self.serviceStopRequested = false
      self.moduleLock.unlock()

      DispatchQueue.global(qos: .userInitiated).async { [weak self] in
        guard let self else {
          promise.reject("MODULE_UNAVAILABLE", "Module deallocated")
          return
        }

        var stopRequested = false
        defer {
          self.moduleLock.lock()
          self.serviceStopRequested = false
          self.moduleLock.unlock()
        }

        let counter = SweepCursor()

        // mDNS meta-query ("_services._dns-sd._udp") via NWBrowser.
        let browser = MdnsBrowser()
        browser.start { typeName in
          self.moduleLock.lock()
          stopRequested = self.serviceStopRequested
          self.moduleLock.unlock()
          if stopRequested { return }
          counter.recordFound()
          DispatchQueue.main.async {
            self.sendEvent("onServiceDiscovered", ["kind": "mdns", "serviceName": typeName])
          }
        }

        // SSDP M-SEARCH responses.
        SsdpProbe.search(
          windowMs: timeoutMs,
          stopFlag: {
            self.moduleLock.lock()
            let flag = self.serviceStopRequested
            self.moduleLock.unlock()
            return flag
          },
          onDiscovered: { location, server, usn, host in
            counter.recordFound()
            let payload: [String: Any] = [
              "kind": "ssdp",
              "location": location ?? NSNull(),
              "server": server ?? NSNull(),
              "usn": usn ?? NSNull(),
              "host": host ?? NSNull(),
            ]
            DispatchQueue.main.async {
              self.sendEvent("onServiceDiscovered", payload)
            }
          }
        )

        browser.stop()

        self.moduleLock.lock()
        stopRequested = self.serviceStopRequested
        self.moduleLock.unlock()

        let completePayload: [String: Any] = [
          "mdnsCount": NSNull(),
          "ssdpCount": NSNull(),
          "cancelled": stopRequested,
        ]
        DispatchQueue.main.async {
          self.sendEvent("onServiceScanComplete", completePayload)
          promise.resolve(true)
        }
      }
    }

    AsyncFunction("stopServiceDiscovery") { (promise: Promise) in
      self.moduleLock.lock()
      self.serviceStopRequested = true
      self.moduleLock.unlock()
      promise.resolve(true)
    }

    /**
     * SPEC §5: one TCP handshake measurement. RTT valid for BOTH `open`
     * connects and `refused` (TCP RST carrier, AGENTS.md #2); offline
     * verdicts resolve rttMs = nil for PingEngine packet-loss accounting.
     */
    AsyncFunction("measureTcpHandshake") { (ip: String, port: Int, timeoutMs: Int, promise: Promise) in
      guard port >= 1, port <= 65535 else {
        promise.reject("INVALID_PARAMS", "port must be in 1..65535")
        return
      }
      guard timeoutMs >= 1, timeoutMs <= 10_000 else {
        promise.reject("INVALID_PARAMS", "timeoutMs must be in 1..10000")
        return
      }
      let target = ip.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !target.isEmpty, target.count <= 45 else {
        promise.reject("INVALID_PARAMS", "invalid target address")
        return
      }
      DispatchQueue.global(qos: .userInitiated).async {
        let result = DiagnosticProbes.measureHandshake(ip: target, port: port, timeoutMs: timeoutMs)
        let payload: [String: Any] = [
          "outcome": result.outcome.rawValue,
          "rttMs": result.elapsedMs ?? NSNull(),
        ]
        promise.resolve(payload)
      }
    }

    /// SPEC §5: native resolver bridge (getaddrinfo, IPv4-first).
    AsyncFunction("resolveHostname") { (hostname: String, promise: Promise) in
      let target = hostname.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !target.isEmpty, target.count <= 253 else {
        promise.reject("INVALID_HOSTNAME", "hostname must be 1..253 characters")
        return
      }
      DispatchQueue.global(qos: .userInitiated).async {
        let measurement = DiagnosticProbes.resolveHostname(target)
        let payload: [String: Any] = [
          "hostname": measurement.hostname,
          "addresses": measurement.addresses,
          "durationMs": measurement.durationMs,
          "success": measurement.success,
        ]
        promise.resolve(payload)
      }
    }

    OnDestroy { }
  }
}
