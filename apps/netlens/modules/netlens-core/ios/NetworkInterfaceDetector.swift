import Darwin

// MARK: - Interface facts (FR-1)

struct NetLensInterfaceInfo {
  let localIp: String
  let cidrPrefix: Int
  let gatewayIp: String?
}

/**
 * FR-1 detector:
 *  - local IP + CIDR prefix from POSIX getifaddrs() filtered to `en0`/AF_INET
 *    (ifa_netmask parsed to prefix length).
 *  - gateway from the IPv4 route table via sysctl(NET_RT_DUMP) — the first
 *    default route (destination 0.0.0.0) carrying RTF_GATEWAY.
 *    The rt_msghdr slot after the destination is only returned when the route
 *    is a default route; otherwise nil.
 */
enum NetworkInterfaceDetector {

  static func detectActiveInterface(interfaceName: String) -> NetLensInterfaceInfo? {
    guard let local = localInterface(interfaceName: interfaceName) else { return nil }
    let gateway = RouteTableGateway.defaultGatewayIpv4()
    return NetLensInterfaceInfo(
      localIp: local.localIp,
      cidrPrefix: local.cidrPrefix,
      gatewayIp: gateway,
    )
  }

  // MARK: getifaddrs

  private static func localInterface(
    interfaceName: String
  ) -> (localIp: String, cidrPrefix: Int)? {
    var interfaceListPointer: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&interfaceListPointer) == 0, let base = interfaceListPointer else {
      return nil
    }
    defer { freeifaddrs(interfaceListPointer) }

    var current: UnsafeMutablePointer<ifaddrs>? = base
    while let node = current {
      let entry = node.pointee
      if let rawName = entry.ifa_name,
         String(cString: rawName) == interfaceName,
         let addressPtr = entry.ifa_addr,
         addressPtr.pointee.sa_family == sa_family_t(AF_INET) {
        let inetPointer = UnsafeRawPointer(addressPtr).assumingMemoryBound(to: sockaddr_in.self)
        let localIp = ipv4String(fromAddress: inetPointer.pointee)
        var prefix = 24
        if let netmaskPtr = entry.ifa_netmask {
          let netmask = UnsafeRawPointer(netmaskPtr).assumingMemoryBound(to: sockaddr_in.self).pointee
          if let parsed = maskPrefixLength(netmask) {
            prefix = parsed
          }
        }
        if let localIp {
          return (localIp, prefix)
        }
      }
      current = entry.ifa_next
    }
    return nil
  }

  private static func ipv4String(fromAddress address: sockaddr_in) -> String? {
    var addressCopy = address
    var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
    let result = withUnsafePointer(to: &addressCopy.sin_addr) { pointer -> Bool in
      pointer.withMemoryRebound(to: in_addr.self, capacity: 1) { bound in
        inet_ntop(AF_INET, bound, &buffer, socklen_t(INET_ADDRSTRLEN)) != nil
      }
    }
    guard result else { return nil }
    return String(cString: buffer)
  }

  private static func maskPrefixLength(_ mask: sockaddr_in) -> Int? {
    let hostOrder = UInt32(bigEndian: mask.sin_addr.s_addr)
    guard hostOrder != 0 else { return nil }
    return hostOrder.nonzeroBitCount
  }
}

// MARK: - Route table gateway lookup (sysctl NET_RT_DUMP)

private enum RouteTableGateway {

  static func defaultGatewayIpv4() -> String? {
    var mib: [Int32] = [CTL_NET, PF_ROUTE, 0, 0, AF_INET, NET_RT_DUMP]
    var bufferSize: size_t = 0
    guard sysctl(&mib, u_int(mib.count), nil, &bufferSize, nil, 0) == 0, bufferSize > 0 else {
      return nil
    }
    var buffer = [UInt8](repeating: 0, count: bufferSize)
    guard sysctl(&mib, u_int(mib.count), &buffer, &bufferSize, nil, 0) == 0 else {
      return nil
    }

    return buffer.withUnsafeBytes { rawBuffer -> String? in
      let base = rawBuffer.baseAddress!
      let total = Int(bufferSize)
      var offset = 0

      while offset + MemoryLayout<rt_msghdr>.size <= total {
        let header = base.loadUnaligned(fromByteOffset: offset, as: rt_msghdr.self)
        let messageLength = Int(header.rtm_msglen)
        if messageLength == 0 { break }

        let flags = Int(header.rtm_flags)
        let addrsMask = Int(header.rtm_addrs)
        if flags & RTF_GATEWAY != 0, addrsMask & RTA_DST != 0, addrsMask & RTA_GATEWAY != 0 {
          if let gateway = parseGatewayOfDefaultRoute(base, messageStart: offset, addrsMask: addrsMask) {
            return gateway
          }
        }
        offset += messageLength
      }
      return nil
    }
  }

  /// Walks the sockaddr sequence following one rt_msghdr and returns the
  /// AF_INET RTA_GATEWAY address only when the destination is 0.0.0.0.
  private static func parseGatewayOfDefaultRoute(
    _ rawBuffer: UnsafeRawBufferPointer,
    messageStart: Int,
    addrsMask: Int,
  ) -> String? {
    let base = rawBuffer.baseAddress!
    var cursor = messageStart + MemoryLayout<rt_msghdr>.size
    var isDefaultRoute = false
    var gatewayIp: String?

    var index = 0
    while index <= Int(RTAX_MAX) {
      if addrsMask & (1 << index) != 0 {
        guard cursor + 2 <= rawBuffer.count else { break }
        let saLength = Int(base.loadUnaligned(fromByteOffset: cursor, as: UInt8.self))
        let saFamily = Int(base.loadUnaligned(fromByteOffset: cursor + 1, as: UInt8.self))
        let stride = saLength > 0 ? saLength : MemoryLayout<sockaddr_in>.size

        if saFamily == AF_INET, cursor + 8 <= rawBuffer.count {
          let first = base.loadUnaligned(fromByteOffset: cursor + 4, as: UInt8.self)
          let second = base.loadUnaligned(fromByteOffset: cursor + 5, as: UInt8.self)
          let third = base.loadUnaligned(fromByteOffset: cursor + 6, as: UInt8.self)
          let fourth = base.loadUnaligned(fromByteOffset: cursor + 7, as: UInt8.self)
          let addressString = "\(first).\(second).\(third).\(fourth)"

          if index == Int(RTAX_DST) {
            isDefaultRoute = (first, second, third, fourth) == (0, 0, 0, 0)
          } else if index == Int(RTAX_GATEWAY) {
            gatewayIp = addressString
          }
        }
        cursor += stride
      }
      index += 1
    }

    return isDefaultRoute ? gatewayIp : nil
  }
}
