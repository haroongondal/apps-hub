import Network

/**
 * mDNS browser used for the DNS-SD meta-query "_services._dns-sd._udp":
 * each result name is a service *type* present on the LAN (e.g. "_http._tcp").
 */
final class MdnsBrowser {
  private var browser: NWBrowser?

  func start(onServiceType: @escaping (String) -> Void) {
    let parameters = NWParameters()
    let browser = NWBrowser(
      for: .bonjour(type: "_services._dns-sd._udp", domain: "local"),
      using: parameters,
    )
    browser.browseResultsChangedHandler = { results, _ in
      for result in results {
        if case let .service(name, _, _, _) = result {
          onServiceType(name)
        }
      }
    }
    browser.start(queue: DispatchQueue.global(qos: .utility))
    self.browser = browser
  }

  func stop() {
    browser?.cancel()
    browser = nil
  }
}
