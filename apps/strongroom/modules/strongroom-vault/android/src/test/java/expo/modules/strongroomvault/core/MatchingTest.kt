package expo.modules.strongroomvault.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MatchingTest {
  private val certA = "a".repeat(64)
  private val certB = "b".repeat(64)
  private val chrome = AppId("com.android.chrome", Browsers.ALLOWLIST.first { it.pkg == "com.android.chrome" }.certSha256)

  private fun web(https: Boolean, host: String) = Requester.Web(Site(https, host))

  private fun webMatches(saved: Site, r: Requester) = Matching.matches(listOf(saved), emptyList(), r)

  private fun appMatches(saved: AppLink, r: Requester) = Matching.matches(emptyList(), listOf(saved), r)

  @Test fun subdomainMatchesRegistrableDomain() {
    assertTrue(webMatches(Site(true, "example.com"), web(true, "login.example.com")))
    assertTrue(webMatches(Site(true, "login.example.com"), web(true, "example.com")))
    assertTrue(webMatches(Site(true, "a.example.com"), web(true, "b.example.com")))
    assertEquals("example.com", Matching.registrableDomain("login.example.com"))
  }

  @Test fun lookalikeDomainDoesNotMatch() {
    val saved = Site(true, "example.com")
    for (host in listOf("example.com.evil.io", "examp1e.com", "evil-example.com", "example.co", "example.org", "xexample.com")) {
      assertFalse(host, webMatches(saved, web(true, host)))
    }
  }

  @Test fun publicSuffixIsRespected() {
    assertFalse(webMatches(Site(true, "a.github.io"), web(true, "b.github.io")))
    assertTrue(webMatches(Site(true, "a.github.io"), web(true, "www.a.github.io")))
    assertFalse(webMatches(Site(true, "example.co.uk"), web(true, "evil.co.uk")))
    assertFalse(webMatches(Site(true, "github.io"), web(true, "a.github.io")))
  }

  @Test fun httpsLoginNeverFillsOnHttp() {
    assertFalse(webMatches(Site(true, "example.com"), web(false, "example.com")))
    assertTrue(webMatches(Site(true, "example.com"), web(true, "example.com")))
    assertTrue(webMatches(Site(false, "example.com"), web(false, "example.com")))
    assertTrue(webMatches(Site(false, "example.com"), web(true, "example.com")))
  }

  @Test fun ipMatchesOnlyItselfIncludingPort() {
    assertTrue(webMatches(Site(false, "192.168.1.1"), web(false, "192.168.1.1")))
    assertFalse(webMatches(Site(false, "192.168.1.1"), web(false, "192.168.1.1:8080")))
    assertFalse(webMatches(Site(false, "192.168.1.1:8080"), web(false, "192.168.1.1")))
    assertTrue(webMatches(Site(false, "192.168.1.1:8080"), web(false, "192.168.1.1:8080")))
    assertFalse(webMatches(Site(false, "1.1.1.1"), web(false, "9.1.1.1")))
    assertNull(Matching.registrableDomain("192.168.1.1"))
    assertNull(Matching.registrableDomain("127.1"))
    assertNull(Matching.registrableDomain("[::1]:8443"))
    assertTrue(webMatches(Site(false, "[::1]:8443"), web(false, "[::1]:8443")))
    assertFalse(webMatches(Site(false, "[::1]:8443"), web(false, "[::1]")))
  }

  @Test fun registrableDomainIgnoresThePort() {
    assertTrue(webMatches(Site(true, "example.com"), web(true, "login.example.com:8443")))
    assertEquals("example.com", Matching.registrableDomain("login.example.com:8443"))
  }

  @Test fun hostNormalization() {
    assertEquals("example.com", Matching.normalizeHost("Example.COM."))
    assertEquals("xn--bcher-kva.de", Matching.normalizeHost("b\u00fccher.de"))
    assertEquals("xn--bcher-kva.de", Matching.normalizeHost("B\u00dcCHER.DE."))
    assertEquals("xn--bcher-kva.de", Matching.normalizeHost("xn--bcher-kva.de"))
    assertTrue(webMatches(Site(true, "Example.COM."), web(true, "example.com")))
    assertTrue(webMatches(Site(true, "b\u00fccher.de"), web(true, "xn--bcher-kva.de")))
    assertEquals("192.168.1.1:8080", Matching.normalizeHost("192.168.1.1:8080"))
    assertEquals("example.com:8443", Matching.normalizeHost("EXAMPLE.com.:8443"))
    assertEquals("[::1]:8443", Matching.normalizeHost("[::1]:8443"))
    assertEquals("[::1]", Matching.normalizeHost("[::1]"))
  }

  @Test fun idnaDeviationCharactersNeverNormalize() {
    for (h in listOf("fa\u00df.de", "FA\u1e9e.de", "a\u03c2.com", "a\u200cb.com", "a\u200db.com", "fa\u00df.de:8443")) {
      assertNull(h, Matching.normalizeHost(h))
      assertNull(h, Matching.registrableDomain(h))
    }
    assertEquals("xn--fa-hia.de", Matching.normalizeHost("xn--fa-hia.de"))
    assertNull(Matching.siteFromUrl("https://fa\u00df.de/"))
    assertEquals(Site(true, "xn--fa-hia.de"), Matching.siteFromUrl("https://xn--fa-hia.de/"))
  }

  @Test fun idnaDeviationHostNeverMatchesTheMappedDomain() {
    assertNull(Matching.requester(chrome.pkg, chrome.certSha256, "fa\u00df.de", "https", Browsers.ALLOWLIST))
    assertNull(Matching.requester("com.evil", certA, "fa\u00df.de", "https", Browsers.ALLOWLIST))
    assertFalse(webMatches(Site(true, "fass.de"), web(true, "fa\u00df.de")))
    assertFalse(webMatches(Site(true, "fa\u00df.de"), web(true, "fass.de")))
    assertFalse(webMatches(Site(true, "fa\u00df.de"), web(true, "fa\u00df.de")))
    assertFalse(webMatches(Site(true, "fass.de"), web(true, "xn--fa-hia.de")))
  }

  @Test fun invalidHostsNormalizeToNull() {
    val bad = listOf(
      "", ".", "a..b", "exa mple.com", "example.com:", "example.com:0", "example.com:65536", "example.com:80:90",
      "::1", "[::1", "[::1]x", "ex/ample.com", "a@b.com", "x".repeat(64) + ".com",
    )
    for (h in bad) assertNull(h, Matching.normalizeHost(h))
  }

  @Test fun siteFromUrlDropsDefaultPortsAndUserInfo() {
    assertEquals(Site(true, "login.example.com"), Matching.siteFromUrl("https://login.example.com/signin?x=1#y"))
    assertEquals(Site(true, "example.com"), Matching.siteFromUrl("HTTPS://Example.COM:443"))
    assertEquals(Site(false, "example.com"), Matching.siteFromUrl("http://example.com:80/"))
    assertEquals(Site(false, "example.com:443"), Matching.siteFromUrl("http://example.com:443/"))
    assertEquals(Site(true, "192.168.1.1:8080"), Matching.siteFromUrl("https://192.168.1.1:8080/admin"))
    assertEquals(Site(true, "[::1]:8443"), Matching.siteFromUrl("https://[::1]:8443/"))
    assertEquals(Site(true, "good.com"), Matching.siteFromUrl("https://evil.com@good.com/"))
    assertEquals(Site(true, "xn--bcher-kva.de"), Matching.siteFromUrl("https://b\u00fccher.de/"))
    assertNull(Matching.siteFromUrl("android://abc@com.example/"))
    assertNull(Matching.siteFromUrl("ftp://example.com/"))
    assertNull(Matching.siteFromUrl("example.com"))
    assertNull(Matching.siteFromUrl("https:///path"))
    assertNull(Matching.siteFromUrl(""))
  }

  @Test fun appNeedsPackageAndCert() {
    val saved = AppLink(AppId("com.bank", certA), null)
    assertTrue(appMatches(saved, Requester.App(AppId("com.bank", certA), null)))
    assertFalse(appMatches(saved, Requester.App(AppId("com.bank", certB), null)))
    assertFalse(appMatches(saved, Requester.App(AppId("com.other", certA), null)))
  }

  @Test fun appLinksAndSitesNeverCross() {
    val id = AppId("com.bank", certA)
    assertFalse(Matching.matches(listOf(Site(false, "bank.com")), emptyList(), Requester.App(id, "bank.com")))
    assertFalse(Matching.matches(emptyList(), listOf(AppLink(id, null)), web(false, "bank.com")))
  }

  @Test fun appLinkDomainMustEqualTheReportedDomain() {
    val saved = AppLink(AppId("com.x", certA), "bank.com")
    assertTrue(appMatches(saved, Requester.App(saved.app, "bank.com")))
    assertFalse(appMatches(saved, Requester.App(saved.app, "evil.com")))
    assertFalse(appMatches(saved, Requester.App(saved.app, null)))
    assertFalse(appMatches(AppLink(saved.app, null), Requester.App(saved.app, "bank.com")))
  }

  @Test fun webDomainFromNonBrowserIsIgnored() {
    val r = Matching.requester("com.evil", certA, "login.bank.com", "https", Browsers.ALLOWLIST)
    assertEquals(Requester.App(AppId("com.evil", certA), "bank.com"), r)
    // The WebView case: a login saved only for the bank's site must not fill into the app that loaded the bank's page.
    val login = Entry.Login("Bank", "me", "pw", listOf(Site(true, "login.bank.com")), emptyList(), "", 1)
    assertFalse(Matching.matches(login, r!!))
    assertEquals(
      Requester.App(AppId("com.evil", certA), "10.0.0.1:8080"),
      Matching.requester("com.evil", certA, "10.0.0.1:8080", null, Browsers.ALLOWLIST),
    )
    assertNull(Matching.requester("com.evil", certA, "bad host", "https", Browsers.ALLOWLIST))
  }

  @Test fun webDomainFromAllowlistedBrowserIsWeb() {
    assertEquals(
      Requester.Web(Site(true, "login.example.com")),
      Matching.requester(chrome.pkg, chrome.certSha256, "Login.Example.com.", "HTTPS", Browsers.ALLOWLIST),
    )
    assertEquals(
      Requester.Web(Site(true, "example.com")),
      Matching.requester(chrome.pkg, chrome.certSha256, "example.com:443", "https", Browsers.ALLOWLIST),
    )
    assertNull(Matching.requester(chrome.pkg, chrome.certSha256, "bad host", "https", Browsers.ALLOWLIST))
    // Same package name with another certificate is not a browser, so its web domain is ignored.
    assertEquals(
      Requester.App(AppId(chrome.pkg, certA), "example.com"),
      Matching.requester(chrome.pkg, certA, "example.com", "https", Browsers.ALLOWLIST),
    )
  }

  @Test fun nullRegistrableDomainNeverMatchesOtherHost() {
    assertFalse(webMatches(Site(false, "printer"), web(false, "scanner")))
    assertFalse(webMatches(Site(false, "10.0.0.1"), web(false, "10.0.0.2")))
    assertTrue(webMatches(Site(false, "printer"), web(false, "printer")))
    assertTrue(webMatches(Site(false, "10.0.0.1"), web(false, "10.0.0.1")))
    assertFalse(webMatches(Site(false, "com"), web(false, "example.com")))
    assertFalse(webMatches(Site(false, "example.com"), web(false, "com")))
    assertFalse(webMatches(Site(false, "github.io"), web(false, "a.github.io")))
    assertTrue(webMatches(Site(false, "github.io"), web(false, "github.io")))
  }

  @Test fun missingSchemeIsHttp() {
    val r = Matching.requester(chrome.pkg, chrome.certSha256, "example.com", null, Browsers.ALLOWLIST)
    assertEquals(Requester.Web(Site(false, "example.com")), r)
    assertFalse(webMatches(Site(true, "example.com"), r!!))
    assertTrue(webMatches(Site(false, "example.com"), r))
  }

  @Test fun onlyHttpAndHttpsSchemesAreAccepted() {
    for (scheme in listOf("ftp", "file", "chrome-extension", "HTTPS ", " http", "", "https:", "httpss")) {
      assertNull(scheme, Matching.requester(chrome.pkg, chrome.certSha256, "example.com", scheme, Browsers.ALLOWLIST))
      assertNull(scheme, Matching.requester("com.evil", certA, "example.com", scheme, Browsers.ALLOWLIST))
      assertNull(scheme, Matching.requester("com.evil", certA, null, scheme, Browsers.ALLOWLIST))
    }
    assertEquals(Requester.Web(Site(false, "example.com")), Matching.requester(chrome.pkg, chrome.certSha256, "example.com", "HTTP", Browsers.ALLOWLIST))
    assertEquals(Requester.Web(Site(true, "example.com")), Matching.requester(chrome.pkg, chrome.certSha256, "example.com", "Https", Browsers.ALLOWLIST))
  }

  @Test fun unknownRequesterCertMatchesNothing() {
    assertNull(Matching.requester("com.bank", null, null, null, Browsers.ALLOWLIST))
    assertNull(Matching.requester("com.bank", null, "bank.com", "https", Browsers.ALLOWLIST))
    assertNull(Matching.requester("com.bank", "not-a-digest", null, null, Browsers.ALLOWLIST))
  }

  @Test fun allowlistedBrowserIsNeverStoredAsAppLink() {
    assertNull(Matching.requester(chrome.pkg, chrome.certSha256, null, null, Browsers.ALLOWLIST))
    assertNull(Matching.requester(chrome.pkg, chrome.certSha256, "", "https", Browsers.ALLOWLIST))
  }

  @Test fun appOnlyScreenOfNonBrowserHasNullDomain() {
    val own = Requester.App(AppId("com.bank", certA), null)
    assertEquals(own, Matching.requester("com.bank", certA, null, null, Browsers.ALLOWLIST))
    assertEquals(own, Matching.requester("com.bank", certA, "", null, Browsers.ALLOWLIST))
  }

  @Test fun ipAndLocalHostsShowHost() {
    assertTrue(Matching.needsHostLabel(Site(false, "192.168.1.1")))
    assertTrue(Matching.needsHostLabel(Site(false, "nas")))
    assertTrue(Matching.needsHostLabel(Site(false, "printer.local")))
    assertTrue(Matching.needsHostLabel(Site(false, "printer.local:8080")))
    assertTrue(Matching.needsHostLabel(Site(false, "github.io")))
    assertFalse(Matching.needsHostLabel(Site(true, "login.example.com")))
  }

  @Test fun allowlistHoldsChromeAndFirefoxOnly() {
    assertEquals(setOf("com.android.chrome", "org.mozilla.firefox"), Browsers.ALLOWLIST.map { it.pkg }.toSet())
  }
}
