import Network

// All state lives on `queue`; stop() is the only entry point called from another thread.
final class MdnsBrowser {
  static let browseTypes = [
    "_googlecast._tcp", "_airplay._tcp", "_ipp._tcp", "_smb._tcp", "_hap._tcp", "_companion-link._tcp",
  ]
  static let maxResolves = 32
  static let resolveTimeoutMs = 1500

  private let queue = DispatchQueue(label: "app.netlens.mdns")
  private var browsers: [NWBrowser] = []
  private var lastSeenTypes: Set<String> = []
  private var seenInstances: Set<String> = []
  private var inflight: [ObjectIdentifier: NWConnection] = [:]
  private var resolveAttempts = 0
  private var stopped = false

  func start(
    onServiceType: @escaping (String) -> Void,
    onInstance: @escaping (_ instanceName: String, _ serviceType: String, _ host: String) -> Void
  ) {
    queue.sync {
      stopped = false
      let meta = NWBrowser(for: .bonjour(type: "_services._dns-sd._udp", domain: "local"), using: NWParameters())
      meta.browseResultsChangedHandler = { [weak self] results, _ in
        guard let self, !self.stopped else { return }
        for result in results {
          guard case .service(name: let name, type: let type, domain: _, interface: _) = result.endpoint else {
            continue
          }
          let identifier = type.isEmpty ? name : type
          guard !identifier.isEmpty else { continue }
          if !self.lastSeenTypes.contains(identifier) {
            self.lastSeenTypes.insert(identifier)
            onServiceType(identifier)
          }
        }
      }
      meta.start(queue: queue)
      browsers.append(meta)

      for type in Self.browseTypes {
        let browser = NWBrowser(for: .bonjour(type: type, domain: "local"), using: NWParameters())
        browser.browseResultsChangedHandler = { [weak self] results, _ in
          guard let self, !self.stopped else { return }
          for result in results {
            guard case .service(name: let name, type: _, domain: _, interface: _) = result.endpoint else { continue }
            guard self.seenInstances.insert("\(type)|\(name)").inserted else { continue }
            guard self.resolveAttempts < Self.maxResolves else { return }
            self.resolveAttempts += 1
            self.resolve(endpoint: result.endpoint, name: name, type: type, onInstance: onInstance)
          }
        }
        browser.start(queue: queue)
        browsers.append(browser)
      }
    }
  }

  func stop() {
    queue.sync {
      stopped = true
      browsers.forEach { $0.cancel() }
      browsers.removeAll()
      inflight.values.forEach {
        $0.stateUpdateHandler = nil
        $0.cancel()
      }
      inflight.removeAll()
      lastSeenTypes.removeAll()
      seenInstances.removeAll()
      resolveAttempts = 0
    }
  }

  private func resolve(
    endpoint: NWEndpoint,
    name: String,
    type: String,
    onInstance: @escaping (String, String, String) -> Void
  ) {
    // A service endpoint can connect over link-local IPv6; only an IPv4 address is a usable host.
    let parameters = NWParameters.tcp
    (parameters.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options)?.version = .v4
    let connection = NWConnection(to: endpoint, using: parameters)
    let id = ObjectIdentifier(connection)
    inflight[id] = connection

    var timeout: DispatchWorkItem?
    let settle = { [weak self] (host: String?) in
      guard let self, self.inflight.removeValue(forKey: id) != nil else { return }
      timeout?.cancel()
      timeout = nil
      connection.stateUpdateHandler = nil
      connection.cancel()
      if let host, !self.stopped { onInstance(name, type, host) }
    }
    timeout = DispatchWorkItem { settle(nil) }
    queue.asyncAfter(deadline: .now() + .milliseconds(Self.resolveTimeoutMs), execute: timeout!)

    connection.stateUpdateHandler = { state in
      switch state {
      case .ready:
        if case .hostPort(host: .ipv4(let address), port: _)? = connection.currentPath?.remoteEndpoint {
          settle(address.rawValue.map(String.init).joined(separator: "."))
        } else {
          settle(nil)
        }
      case .failed, .waiting:
        settle(nil)
      default:
        break
      }
    }
    connection.start(queue: queue)
  }
}
