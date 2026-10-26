import Darwin

// MARK: - Phase 2 (FR-3) diagnostic probes (SPEC §5)

/// One native resolver measurement (mirrors @apps-hub/core DnsResolution).
/// A failed lookup is still a valid (failed) measurement: `success = false`
/// keeps the elapsed wall time.
struct DnsMeasurement {
  let hostname: String
  let addresses: [String]
  let durationMs: Double
  let success: Bool
}

enum DiagnosticProbes {
  /**
   * TCP handshake RTT carrier. Reuses the hard-rule sweep classifier
   * (TcpProbeEngine): OPEN and REFUSED (TCP RST via SO_ERROR) carry their
   * measured RTTs (AGENTS.md #2); TIMEOUT / UNREACHABLE carry nil so
   * PingEngine counts them as packet loss.
   */
  static func measureHandshake(ip: String, port: Int, timeoutMs: Int) -> TcpProbeResult {
    TcpProbeEngine.probe(host: ip, port: port, timeoutMs: timeoutMs)
  }

  /**
   * One getaddrinfo wall-time round with IPv4 hints so both platforms emit
   * the same payload (Android InetAddress is IPv4-filtered first).
   * NXDOMAIN / resolver timeouts return success=false with the elapsed
   * time intact — a slow failure IS a valid DNS measurement.
   */
  static func resolveHostname(_ hostname: String) -> DnsMeasurement {
    let startedAt = DispatchTime.now()

    var hints = addrinfo()
    hints.ai_family = AF_INET
    hints.ai_socktype = SOCK_STREAM

    var infoPtr: UnsafeMutablePointer<addrinfo>? = nil
    let status = getaddrinfo(hostname, nil, &hints, &infoPtr)
    let durationMs = elapsedMsSince(startedAt)

    guard status == 0, let first = infoPtr else {
      return DnsMeasurement(
        hostname: hostname,
        addresses: [],
        durationMs: durationMs,
        success: false
      )
    }
    defer { freeaddrinfo(first) }

    var seen = Set<String>()
    var addresses: [String] = []
    var cursor: UnsafeMutablePointer<addrinfo>? = first
    while let node = cursor {
      let entry = node.pointee
      if entry.ai_family == AF_INET, let rawAddr = entry.ai_addr {
        let inAddr = rawAddr.withMemoryRebound(to: sockaddr_in.self, capacity: 1) {
          $0.pointee.sin_addr
        }
        var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
        var addrValue = inAddr
        if inet_ntop(AF_INET, &addrValue, &buffer, socklen_t(INET_ADDRSTRLEN)) != nil {
          let text = String(cString: buffer)
          if seen.insert(text).inserted {
            addresses.append(text)
          }
        }
      }
      cursor = entry.ai_next
    }

    return DnsMeasurement(
      hostname: hostname,
      addresses: addresses,
      durationMs: durationMs,
      success: !addresses.isEmpty
    )
  }

  private static func elapsedMsSince(_ startedAt: DispatchTime) -> Double {
    Double(DispatchTime.now().uptimeNanoseconds - startedAt.uptimeNanoseconds) / 1_000_000.0
  }
}
