package expo.modules.strongroomvault.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class EntryJsonTest {
  private val digestA = "0123456789abcdef".repeat(4)
  private val digestB = "fedcba9876543210".repeat(4)

  private val login = Entry.Login(
    name = "Caf\u00e9 \"Example\"",
    username = "me@example.com",
    password = "p\u00e4ss\\w0rd\n\u2713 \uD83D\uDE00",
    sites = listOf(Site(true, "example.com"), Site(false, "intranet.local")),
    apps = listOf(
      AppLink(AppId("com.example.app", digestA), "example.com"),
      AppLink(AppId("com.example.other", digestB), null),
    ),
    note = "line one\nline two\t\u0001",
    updatedAt = 1_700_000_000_000,
  )

  private val entries = listOf(
    login,
    login.copy(sites = emptyList(), apps = emptyList(), note = ""),
    Entry.Card("Visa", "A. Holder", "4111111111111111", 12, 2030, "123", "", 1_700_000_001_000),
    Entry.Card("Gift card", "", "1234", null, null, "", "no expiry", 0),
    Entry.Note("Wi-Fi", "SSID: home\nkey: correct horse", 1_700_000_002_000),
    Entry.Deleted(1_700_000_003_000),
  )

  @Test fun everyEntryTypeRoundTripsThroughJson() {
    for (e in entries) assertEquals(e, EntryJson.decode(EntryJson.encode(e)))
  }

  @Test fun encodingPinsFieldNamesAndOrder() {
    assertEquals(
      """{"type":"login","name":"a","username":"u","password":"p","sites":[{"https":true,"host":"h.com"}],""" +
        """"apps":[{"pkg":"p.k","certSha256":"$digestA","domain":null}],"note":"n","updatedAt":5}""",
      EntryJson.encode(
        Entry.Login("a", "u", "p", listOf(Site(true, "h.com")), listOf(AppLink(AppId("p.k", digestA), null)), "n", 5),
      ),
    )
    assertEquals(
      """{"type":"card","name":"a","holder":"h","number":"1","expMonth":null,"expYear":2030,"cvc":"c","note":"n","updatedAt":5}""",
      EntryJson.encode(Entry.Card("a", "h", "1", null, 2030, "c", "n", 5)),
    )
    assertEquals("""{"type":"note","name":"a","text":"t","updatedAt":5}""", EntryJson.encode(Entry.Note("a", "t", 5)))
    assertEquals("""{"type":"deleted","updatedAt":5}""", EntryJson.encode(Entry.Deleted(5)))
  }

  @Test fun decodeIgnoresUnknownFields() {
    assertEquals(Entry.Deleted(7), EntryJson.decode("""{"type":"deleted","updatedAt":7,"future":{"x":[1]}}"""))
  }

  @Test fun decodeReturnsNullOnAnythingMalformed() {
    val site = """{"https":true,"host":"h"}"""
    val app = """{"pkg":"p","certSha256":"$digestA","domain":null}"""
    fun login(sites: String = "[$site]", apps: String = "[$app]", password: String = "\"p\"", updatedAt: String = "5") =
      """{"type":"login","name":"n","username":"u","password":$password,"sites":$sites,"apps":$apps,"note":"","updatedAt":$updatedAt}"""
    assertNotNull(EntryJson.decode(login()))
    val bad = listOf(
      "",
      "not json",
      "[]",
      "null",
      "\"login\"",
      "{}",
      """{"type":"deleted"}""",
      """{"updatedAt":5}""",
      """{"type":"other","updatedAt":5}""",
      """{"type":5,"updatedAt":5}""",
      """{"type":"deleted","updatedAt":"5"}""",
      """{"type":"deleted","updatedAt":5.5}""",
      """{"type":"deleted","updatedAt":null}""",
      """{"type":"note","name":"n","updatedAt":5}""",
      """{"type":"note","name":1,"text":"t","updatedAt":5}""",
      """{"type":"card","name":"n","holder":"h","number":"1","expMonth":"12","expYear":null,"cvc":"c","note":"","updatedAt":5}""",
      """{"type":"card","name":"n","holder":"h","number":"1","expMonth":1,"cvc":"c","note":"","updatedAt":5}""",
      login(password = "5"),
      login(password = "null"),
      login(sites = "{}"),
      login(sites = "[1]"),
      login(sites = """[{"https":"true","host":"h"}]"""),
      login(sites = """[{"https":true}]"""),
      login(apps = """[{"pkg":"p","certSha256":"$digestA"}]"""),
      login(apps = """[{"pkg":"p","certSha256":"$digestA","domain":5}]"""),
      login(apps = """[{"pkg":"p","certSha256":"","domain":null}]"""),
      login(apps = """[{"pkg":"p","certSha256":"${digestA.take(63)}","domain":null}]"""),
      login(apps = """[{"pkg":"p","certSha256":"${digestA.uppercase()}","domain":null}]"""),
      login(apps = """[{"pkg":"p","certSha256":"${digestA}0","domain":null}]"""),
      login(apps = """[{"pkg":"p","certSha256":"${"g".repeat(64)}","domain":null}]"""),
      "[".repeat(200_000) + "]".repeat(200_000),
      """{"type":"note","name":""" + "[".repeat(200_000) + "]".repeat(200_000) + ""","text":"t","updatedAt":5}""",
    )
    for (s in bad) assertNull(s, EntryJson.decode(s))
  }

  @Test fun toStringRedactsPasswordNumberAndCvc() {
    val l = Entry.Login("site", "someone", "hunter2-secret", emptyList(), emptyList(), "", 1).toString()
    assertTrue(l, "password=***" in l && "someone" in l)
    assertFalse(l, "hunter2-secret" in l)
    val c = Entry.Card("Visa", "A. Holder", "4111111111111111", 12, 2030, "987", "", 1).toString()
    assertTrue(c, "number=***" in c && "cvc=***" in c && "A. Holder" in c)
    assertFalse(c, "4111111111111111" in c || "987" in c)
  }

  @Test fun appIdRefusesABrokenDigest() {
    assertEquals(digestA, AppId("p", digestA).certSha256)
    for (d in listOf("", digestA.take(63), digestA + "0", digestA.uppercase(), "g".repeat(64))) {
      assertThrows(d, IllegalArgumentException::class.java) { AppId("p", d) }
    }
  }
}
