import Network

/**
 * mDNS browser used for the DNS-SD meta-query "_services._dns-sd._udp":
 * each discovered endpoint names one service TYPE present on the LAN
 * (e.g. "_http._tcp"). Service types are emitted once on first appearance.
 */
final class MdnsBrowser {
  private var browser: NWBrowser?
  private var lastSeenTypes: Set<String> = []

  func start(onServiceType: @escaping (String) -> Void) {
    let browser = NWBrowser(
      for: .bonjour(type: "_services._dns-sd._udp", domain: "local"),
      using: NWParameters()
    )
    browser.browseResultsChangedHandler = { [weak self] results, _ in
      guard let self else { return }
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
    browser.start(queue: DispatchQueue.global(qos: .utility))
    self.browser = browser
  }

  func stop() {
    browser?.cancel()
    browser = nil
    lastSeenTypes.removeAll()
  }
}
