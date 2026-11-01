import Darwin
import Foundation
import Network

enum NameProbes {
  private static let sliceMs = 250
  private static let udpBuffer = 4096
  private static let tcpChunk = 4096

  static func udpRequest(ip: String, port: Int, payload: [UInt8], timeoutMs: Int) -> [UInt8]? {
    var target = sockaddr_in()
    target.sin_family = sa_family_t(AF_INET)
    target.sin_port = in_port_t(UInt16(port).bigEndian)
    guard inet_pton(AF_INET, ip, &target.sin_addr) == 1 else { return nil }

    let fd = Darwin.socket(AF_INET, SOCK_DGRAM, 0)
    guard fd >= 0 else { return nil }
    defer { Darwin.close(fd) }

    let sent = payload.withUnsafeBytes { bytes -> Int in
      withUnsafePointer(to: &target) { targetPointer in
        targetPointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
          sendto(fd, bytes.baseAddress, bytes.count, 0, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
      }
    }
    guard sent == payload.count else { return nil }

    let deadline = DispatchTime.now().uptimeNanoseconds + UInt64(timeoutMs) * 1_000_000
    var buffer = [UInt8](repeating: 0, count: udpBuffer)
    while true {
      let remainingMs = (Int64(deadline) - Int64(DispatchTime.now().uptimeNanoseconds)) / 1_000_000
      if remainingMs <= 0 { return nil }
      // A zero timeval means "block forever", so the slice must stay at least 1 ms.
      var slice = timeval(tv_sec: 0, tv_usec: Int32(min(remainingMs, Int64(sliceMs))) * 1000)
      _ = setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &slice, socklen_t(MemoryLayout<timeval>.size))

      var source = sockaddr_in()
      var sourceLength = socklen_t(MemoryLayout<sockaddr_in>.size)
      let capacity = buffer.count
      let received = buffer.withUnsafeMutableBytes { bytes -> Int in
        withUnsafeMutablePointer(to: &source) { sourcePointer in
          sourcePointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
            Darwin.recvfrom(fd, bytes.baseAddress, capacity, 0, sockaddrPointer, &sourceLength)
          }
        }
      }
      if received < 0 {
        let code = errno
        if code == EAGAIN || code == EWOULDBLOCK || code == EINTR { continue }
        return nil
      }
      if source.sin_addr.s_addr == target.sin_addr.s_addr && source.sin_port == target.sin_port {
        return Array(buffer[0..<received])
      }
    }
  }

  static func tcpFetch(
    ip: String,
    port: Int,
    request: String,
    timeoutMs: Int,
    maxBytes: Int,
    completion: @escaping (String?) -> Void
  ) {
    guard let nwPort = NWEndpoint.Port(rawValue: UInt16(port)) else {
      completion(nil)
      return
    }
    TcpFetchSession(
      connection: NWConnection(host: NWEndpoint.Host(ip), port: nwPort, using: .tcp),
      request: Data(request.utf8),
      timeoutMs: timeoutMs,
      maxBytes: maxBytes,
      completion: completion
    ).start()
  }

  private final class TcpFetchSession {
    private let queue = DispatchQueue(label: "app.netlens.tcp-fetch")
    private let connection: NWConnection
    private let request: Data
    private let timeoutMs: Int
    private let maxBytes: Int
    private var body = Data()
    private var completion: ((String?) -> Void)?

    init(connection: NWConnection, request: Data, timeoutMs: Int, maxBytes: Int, completion: @escaping (String?) -> Void) {
      self.connection = connection
      self.request = request
      self.timeoutMs = timeoutMs
      self.maxBytes = maxBytes
      self.completion = completion
    }

    func start() {
      connection.stateUpdateHandler = { [self] state in
        switch state {
        case .ready:
          connection.send(content: request, completion: .contentProcessed { [self] error in
            if error != nil { finish() }
          })
          receive()
        // waiting means the connect cannot complete (refused, no route, local network denied): give up now.
        case .waiting, .failed:
          finish()
        default:
          break
        }
      }
      connection.start(queue: queue)
      queue.asyncAfter(deadline: .now() + .milliseconds(timeoutMs)) { [self] in finish() }
    }

    private func receive() {
      let room = maxBytes - body.count
      guard room > 0 else { return finish() }
      connection.receive(minimumIncompleteLength: 1, maximumLength: min(room, NameProbes.tcpChunk)) { [self] data, _, isComplete, error in
        guard completion != nil else { return }
        if let data { body.append(data) }
        if error != nil || isComplete || body.count >= maxBytes { finish() } else { receive() }
      }
    }

    private func finish() {
      guard let done = completion else { return }
      completion = nil
      connection.stateUpdateHandler = nil
      connection.cancel()
      done(body.isEmpty ? nil : String(decoding: body, as: UTF8.self))
    }
  }
}
