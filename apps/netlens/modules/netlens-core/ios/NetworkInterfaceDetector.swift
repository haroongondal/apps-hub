import Darwin

// MARK: - <net/route.h> mirroring (not exposed via the Darwin Swift module)

/**
 * BSD route-message contract mirrored from <net/route.h>.
 * Only used to parse the sysctl(CTL_NET, PF_ROUTE, …, NET_RT_DUMP) byte
 * stream; the field layout must match the kernel's rt_msghdr exactly.
 */
private let routeFlagGateway: Int32 = 0x0002 // RTF_GATEWAY (compared against rtm_flags)
private let routeAttrDst = 0x0001            // RTA_DST (compared against Int rtm_addrs mask)
private let routeAttrGateway = 0x0002        // RTA_GATEWAY
private let routeAddrTypeDst = 0      // RTAX_DST
private let routeAddrTypeGateway = 1  // RTAX_GATEWAY
private let routeAddrTypeMax = 8      // RTAX_MAX

private struct BSDRouteMessageHeader {
  var rtm_msglen: UInt16
  var rtm_version: UInt8
  var rtm_type: UInt8
  var rtm_index: UInt16
  var rtm_flags: Int32
  var rtm_addrs: Int32
  var rtm_pid: Int32
  var rtm_seq: Int32
  var rtm_errno: Int32
  var rtm_use: Int32
  var rtm_inits: UInt64
  // struct rt_metrics — 14 u_long values on LP64 (locks, mtu, hopcount, …,
  // state, filler[2]); parsed but never dereferenced.
  var rtm_rmx: (UInt64, UInt64, UInt64, UInt64, UInt64, UInt64, UInt64, UInt64, UInt64, UInt64, UInt64, UInt64, UInt64, UInt64)
}

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
 *    default route (destination 0.0.0.0) carrying a gateway address.
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
      let headerSize = MemoryLayout<BSDRouteMessageHeader>.size

      while offset + 4 <= total {
        let messageLength = Int(base.loadUnaligned(fromByteOffset: offset, as: UInt16.self))
        if messageLength == 0 { break }

        if messageLength >= headerSize {
          let header = base.loadUnaligned(
            fromByteOffset: offset,
            as: BSDRouteMessageHeader.self,
          )
          let flags = header.rtm_flags
          let addrsMask = Int(header.rtm_addrs)
          if flags & routeFlagGateway != 0,
             addrsMask & routeAttrDst != 0,
             addrsMask & routeAttrGateway != 0 {
            if let gateway = parseGatewayOfDefaultRoute(rawBuffer, messageStart: offset, addrsMask: addrsMask) {
              return gateway
            }
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
    var cursor = messageStart + MemoryLayout<BSDRouteMessageHeader>.size
    var isDefaultRoute = false
    var gatewayIp: String?

    var index = 0
    while index <= routeAddrTypeMax {
      if addrsMask & (1 << index) != 0 {
        guard cursor + 2 <= rawBuffer.count else { break }
        let saLength = Int(base.loadUnaligned(fromByteOffset: cursor, as: UInt8.self))
        let saFamily = Int(base.loadUnaligned(fromByteOffset: cursor + 1, as: UInt8.self))
        let stride = saLength > 0 ? saLength : 16

        if saFamily == AF_INET, cursor + 8 <= rawBuffer.count {
          let first = base.loadUnaligned(fromByteOffset: cursor + 4, as: UInt8.self)
          let second = base.loadUnaligned(fromByteOffset: cursor + 5, as: UInt8.self)
          let third = base.loadUnaligned(fromByteOffset: cursor + 6, as: UInt8.self)
          let fourth = base.loadUnaligned(fromByteOffset: cursor + 7, as: UInt8.self)
          let addressString = "\(first).\(second).\(third).\(fourth)"

          if index == routeAddrTypeDst {
            isDefaultRoute = (first, second, third, fourth) == (0, 0, 0, 0)
          } else if index == routeAddrTypeGateway {
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
