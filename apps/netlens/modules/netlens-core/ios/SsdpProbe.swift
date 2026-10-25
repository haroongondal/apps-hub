import Darwin

/**
 * SSDP discovery, iOS side: UDP M-SEARCH to 239.255.255.250:1900, then parse
 * LOCATION / SERVER / USN headers from unicast responses until the window
 * closes. Runs on a caller-provided queue; fully cancellable through a
 * `stopFlag` closure (poll ≤ 250 ms per recvfrom).
 */
enum SsdpProbe {

  private static let ssdpMulticastAddress = "239.255.255.250"
  private static let ssdpPort: UInt16 = 1900
  private static let recvTimeoutMs: Int32 = 250

  static let mSearchPayload = [
    "M-SEARCH * HTTP/1.1",
    "HOST: 239.255.255.250:1900",
    "MAN: \"ssdp:discover\"",
    "MX: 2",
    "ST: ssdp:all",
    "",
    "",
  ].joined(separator: "\r\n")

  /** Returns LOCATION/SERVER/USN triple (each optional) + responder host. */
  typealias DiscoveredCallback = (
    _ location: String?,
    _ server: String?,
    _ usn: String?,
    _ host: String?
  ) -> Void

  static func search(
    windowMs: Int,
    stopFlag: () -> Bool,
    onDiscovered: @escaping DiscoveredCallback,
  ) {
    let socketDescriptor = Darwin.socket(AF_INET, SOCK_DGRAM, 0)
    guard socketDescriptor >= 0 else { return }
    defer { Darwin.close(socketDescriptor) }

    // Set receive timeout so the response loop stays cancellable.
    var tv = timeval(tv_sec: 0, tv_usec: recvTimeoutMs * 1000)
    _ = setsockopt(
      socketDescriptor,
      SOL_SOCKET,
      SO_RCVTIMEO,
      &tv,
      socklen_t(MemoryLayout<timeval>.size),
    )

    // Group membership for responses? SSDP replies are UNICAST to our source
    // port, but some boxes multicast NOTIFY bursts too; join the group so we
    // can also observe notify-style traffic through the same socket.
    var membership = ip_mreq(imr_multiaddr: in_addr(), imr_interface: in_addr())
    inet_pton(AF_INET, ssdpMulticastAddress, &membership.imr_multiaddr)
    membership.imr_interface.s_addr = INADDR_ANY
    _ = setsockopt(
      socketDescriptor,
      IPPROTO_IP,
      IP_ADD_MEMBERSHIP,
      &membership,
      socklen_t(MemoryLayout<ip_mreq>.size),
    )

    var destination = sockaddr_in()
    destination.sin_family = sa_family_t(AF_INET)
    destination.sin_port = in_port_t(ssdpPort.bigEndian)
    inet_pton(AF_INET, ssdpMulticastAddress, &destination.sin_addr)

    let payloadBytes = Array(mSearchPayload.utf8)
    let sent = payloadBytes.withUnsafeBytes { bytesRpc -> Int in
      withUnsafePointer(to: &destination) { destinationPointer in
        destinationPointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
          sendto(
            socketDescriptor,
            bytesRpc.baseAddress,
            bytesRpc.count,
            0,
            sockaddrPointer,
            socklen_t(MemoryLayout<sockaddr_in>.size),
          )
        }
      }
    }
    guard sent > 0 else { return }

    let startedAt = DispatchTime.now()
    var buffer = [UInt8](repeating: 0, count: 4096)

    while !stopFlag() {
      let elapsed = Double(DispatchTime.now().uptimeNanoseconds - startedAt.uptimeNanoseconds) / 1_000_000.0
      if elapsed > Double(windowMs) { break }

      var source = sockaddr()
      var sourceLength = socklen_t(MemoryLayout<sockaddr>.size)
      let received = buffer.withUnsafeMutableBytes { mutableBytes -> Int in
        Darwin.recvfrom(
          socketDescriptor,
          mutableBytes.baseAddress,
          buffer.count,
          0,
          &source,
          &sourceLength,
        )
      }
      guard received > 0 else { continue } // timeout or transient error

      var sourceName = ""
      var sourceAddr = withUnsafePointer(to: &source) { pointer -> in_addr? in
        pointer.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { bound in
          bound.pointee.sin_addr
        }
      }
      if let sourceAddr {
        var addrBuffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
        if withUnsafePointer(to: &sourceAddr) { pointer -> Bool in
          pointer.withMemoryRebound(to: in_addr.self, capacity: 1) { bound in
            inet_ntop(AF_INET, bound, &addrBuffer, socklen_t(INET_ADDRSTRLEN)) != nil
          }
        } {
          sourceName = String(cString: addrBuffer)
        }
      }

      let text = String(bytes: buffer[0..<received], encoding: .utf8) ?? ""
      let location = header(in: text, name: "LOCATION")
      let server = header(in: text, name: "SERVER")
      let usn = header(in: text, name: "USN")
      if location != nil || server != nil || usn != nil {
        onDiscovered(location, server, usn, sourceName.isEmpty ? nil : sourceName)
      }
    }
  }

  static func header(in raw: String, name: String) -> String? {
    raw
      .split(separator: "\n", omittingEmptySubsequences: false)
      .first { line in
        line.uppercased().hasPrefix("\(name):")
      }
      .map { $0.dropFirst(name.count + 1).trimmingCharacters(in: .whitespacesAndNewlines) }
      .flatMap { $0.isEmpty ? nil : $0 }
  }
}
