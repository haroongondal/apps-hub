package expo.modules.strongroomvault.core

import org.junit.Assert.assertEquals
import org.junit.Test

class TotpFillTest {
  // RFC 6238's SHA1 secret (12345678901234567890); 6 digits at T=59 is the vector OtpTest pins too.
  private val uri = "otpauth://totp/Example:me@example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Example"
  private val web = Requester.Web(Site(true, "example.com"))

  private fun login(name: String, sites: List<Site> = listOf(Site(true, "example.com")), totp: String? = uri) =
    Entry.Login(name, "me", "pw", sites, emptyList(), "", 0, totp)

  private fun names(entries: List<Pair<Entry.Login, String>>) = entries.map { it.first.name }

  @Test fun onlyMatchingLoginsThatHoldACodeFill() {
    val entries = listOf(
      login("Bank"),
      login("NoCode", totp = null),
      login("Elsewhere", sites = listOf(Site(true, "other.example"))),
      Entry.Card("Visa", "", "4111111111111111", null, null, "123", "", 0),
      Entry.Note("n", "secret", 0),
    )
    assertEquals(listOf("Bank" to "287082"), TotpFill.logins(entries, web, 59).map { it.first.name to it.second })
  }

  @Test fun loginsArriveSortedByNameLikeTheLoginStrip() {
    assertEquals(listOf("alpha", "Midway", "Zeta"), names(TotpFill.logins(listOf(login("Zeta"), login("alpha"), login("Midway")), web, 59)))
  }

  @Test fun anAppRequesterMatchesByAppNotBySite() {
    val id = AppId("com.bank.app", "ab".repeat(32))
    val appLogin = Entry.Login("App", "", "pw", emptyList(), listOf(AppLink(id, null)), "", 0, uri)
    assertEquals(listOf("App"), names(TotpFill.logins(listOf(appLogin), Requester.App(id, null), 59)))
    assertEquals(emptyList<String>(), names(TotpFill.logins(listOf(appLogin), web, 59)))
  }

  @Test fun theCodeIsTheRfc6238VectorAtTheGivenSecond() {
    assertEquals("287082", TotpFill.logins(listOf(login("Bank")), web, 59).single().second)
    assertEquals("081804", TotpFill.logins(listOf(login("Bank")), web, 1111111109).single().second)
  }
}
