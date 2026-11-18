import Darwin
import Foundation

/// Fire-and-forget datagram for Wake-on-LAN. Only private IPv4 destinations are allowed, so a bad or hostile
/// address can never make the app send traffic to the internet. Mirrors UdpBroadcast.kt: same rules, same error texts.
enum UdpBroadcast {
  private static let maxPayload = 1024

  /// Error text, or nil when the datagram may be sent. `ip` must already be trimmed.
  static func validate(ip: String, port: Int, payload: [Int]) -> String? {
    guard let octets = parseIpv4(ip) else { return "ip must be a dotted-quad IPv4 address" }
    if !isPrivate(octets) { return "ip must be a private IPv4 address" }
    if port < 1 || port > 65535 { return "port must be in 1..65535" }
    if payload.isEmpty || payload.count > maxPayload { return "payload must be 1..\(maxPayload) bytes" }
    if payload.contains(where: { $0 < 0 || $0 > 255 }) { return "payload bytes must be in 0..255" }
    return nil
  }

  /// Four decimal octets, no signs, no leading zeros, no hex or short forms. Never touches DNS.
  private static func parseIpv4(_ ip: String) -> [Int]? {
    let parts = ip.split(separator: ".", omittingEmptySubsequences: false)
    if parts.count != 4 { return nil }
    var octets: [Int] = []
    for part in parts {
      let digits = Array(part.utf8)
      if digits.isEmpty || digits.count > 3 || digits.contains(where: { $0 < 0x30 || $0 > 0x39 }) { return nil }
      if digits.count > 1 && digits[0] == 0x30 { return nil }
      guard let value = Int(part), value <= 255 else { return nil }
      octets.append(value)
    }
    return octets
  }

  /// 10/8, 172.16/12, 192.168/16 and link-local 169.254/16 (same set as isPrivateIpv4 in packages/core).
  private static func isPrivate(_ o: [Int]) -> Bool {
    o[0] == 10 || (o[0] == 172 && o[1] >= 16 && o[1] <= 31) || (o[0] == 192 && o[1] == 168) || (o[0] == 169 && o[1] == 254)
  }

  /// Sends one datagram to a validated `ip`. True only when the whole payload went out (a short send is a failure).
  static func send(ip: String, port: Int, payload: [UInt8]) -> Bool {
    var target = sockaddr_in()
    target.sin_family = sa_family_t(AF_INET)
    target.sin_port = in_port_t(UInt16(port).bigEndian)
    guard inet_pton(AF_INET, ip, &target.sin_addr) == 1 else { return false }

    let fd = Darwin.socket(AF_INET, SOCK_DGRAM, 0)
    guard fd >= 0 else { return false }
    defer { Darwin.close(fd) }

    var enable: Int32 = 1
    guard setsockopt(fd, SOL_SOCKET, SO_BROADCAST, &enable, socklen_t(MemoryLayout<Int32>.size)) == 0 else { return false }

    let sent = payload.withUnsafeBytes { bytes -> Int in
      withUnsafePointer(to: &target) { targetPointer in
        targetPointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
          sendto(fd, bytes.baseAddress, bytes.count, 0, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
      }
    }
    return sent == payload.count
  }
}
