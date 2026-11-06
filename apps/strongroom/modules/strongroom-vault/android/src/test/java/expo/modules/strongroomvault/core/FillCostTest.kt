package expo.modules.strongroomvault.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// A fill request runs the matcher over every login, so per-request work must not be repeated per saved site.
class FillCostTest {
  private val cert = "c".repeat(64)
  private val suffixes = listOf("com", "co.uk", "com.au", "github.io", "de", "co.jp")
  private val logins = (0 until 600).map { n ->
    val sites = (0..n % 3).map { k -> Site(n % 4 != 0, listOf("site$n", "login.site$n", "a.b.site$n")[k] + "." + suffixes[n % suffixes.size]) }
    Entry.Login("Login $n", "user$n", "pw$n", sites, if (n % 6 == 0) listOf(AppLink(AppId("com.app$n", cert), null)) else emptyList(), "", 1)
  }
  private val savedSites = logins.sumOf { it.sites.size }

  private fun lookupsFor(block: () -> Unit): Int {
    Matching.registrableDomain("warm.example.com") // load the list first
    PublicSuffix.lookups = 0
    block()
    return PublicSuffix.lookups
  }

  @Test fun theRequesterIsLookedUpOncePerRequestNotOncePerSavedSite() {
    val web = Requester.Web(Site(true, "accounts.nomatch-site.org"))
    val index = MatchIndex.build(logins.mapIndexed { i, l -> "id$i" to l }.toMap())
    val viaIndex = lookupsFor { assertEquals(emptyList<IndexItem>(), MatchIndex.find(index, web)) }
    assertTrue("$viaIndex PSL lookups for $savedSites saved sites", viaIndex <= savedSites + 1)
    val match = Matching.matcher(web)
    val viaEntries = lookupsFor { assertEquals(emptyList<Entry.Login>(), logins.filter { match(it.sites, it.apps) }) }
    assertTrue("$viaEntries PSL lookups for $savedSites saved sites", viaEntries <= savedSites + 1)
  }

  @Test fun anAppRequesterNeedsNoLookups() {
    val app = Requester.App(AppId("com.nomatch", cert), null)
    assertEquals(0, lookupsFor { assertEquals(emptyList<Entry.Login>(), logins.filter { Matching.matcher(app)(it.sites, it.apps) }) })
  }

  @Test fun oneMatcherGivesEachLoginItsOwnAnswer() {
    fun login(vararg sites: Site) = Entry.Login("x", "u", "p", sites.toList(), emptyList(), "", 1)
    val candidates = listOf(
      login(Site(true, "example.com")),
      login(Site(true, "example.com.evil.io")),
      login(Site(false, "sub.example.com")),
      login(Site(true, "10.0.0.1")),
      login(Site(true, "evil.io"), Site(true, "www.example.com")),
      login(),
    )
    val requester = Requester.Web(Site(true, "login.example.com"))
    val match = Matching.matcher(requester)
    assertEquals(listOf(true, false, true, false, true, false), candidates.map { match(it.sites, it.apps) })
    assertEquals(candidates.map { Matching.matches(it, requester) }, candidates.map { match(it.sites, it.apps) })
    val http = Matching.matcher(Requester.Web(Site(false, "example.com")))
    assertEquals(listOf(false, false, true, false, false, false), candidates.map { http(it.sites, it.apps) })
    val ip = Matching.matcher(Requester.Web(Site(true, "10.0.0.1")))
    assertEquals(listOf(false, false, false, true, false, false), candidates.map { ip(it.sites, it.apps) })
    val unreadable = Matching.matcher(Requester.Web(Site(true, "bad host")))
    assertEquals(List(6) { false }, candidates.map { unreadable(it.sites, it.apps) })
  }
}
