package expo.modules.strongroomvault.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MatchIndexTest {
  private val cert = "c".repeat(64)
  private val id = AppId("com.bank", cert)
  private val bank = Entry.Login("Bank", "me@bank.com", "hunter2-unique", listOf(Site(true, "bank.com")), listOf(AppLink(id, "bank.com")), "secret note", 1)
  private val mail = Entry.Login("mail", "me@example.com", "p4ss-unique", listOf(Site(false, "example.com")), emptyList(), "", 2)
  private val card = Entry.Card("Visa", "A. Holder", "4111111111119876", 12, 2030, "321", "", 3)
  private val note = Entry.Note("Wi-Fi", "the secret text", 4)
  private val entries = mapOf("b" to bank, "m" to mail, "c" to card, "n" to note, "d" to Entry.Deleted(5))

  @Test fun buildKeepsOnlyLoginsInNameOrder() {
    assertEquals(
      listOf(IndexItem("b", "Bank", "me@bank.com", bank.sites, bank.apps), IndexItem("m", "mail", "me@example.com", mail.sites, mail.apps)),
      MatchIndex.build(entries),
    )
  }

  @Test fun indexHoldsNoPasswords() {
    val text = String(MatchIndex.encode(MatchIndex.build(entries)), Charsets.UTF_8)
    for (secret in listOf("hunter2-unique", "p4ss-unique", "secret note", "4111", "321", "the secret text", "Visa")) {
      assertFalse(secret, text.contains(secret))
    }
    assertTrue(text.contains("me@bank.com"))
  }

  @Test fun indexRoundTrips() {
    val items = MatchIndex.build(entries)
    assertEquals(items, MatchIndex.decode(MatchIndex.encode(items)))
    assertEquals(emptyList<IndexItem>(), MatchIndex.decode(MatchIndex.encode(emptyList())))
  }

  @Test fun encodingReusesTheEntryFieldNames() {
    assertEquals(
      """[{"id":"b","name":"Bank","username":"u","sites":[{"https":true,"host":"bank.com"}],""" +
        """"apps":[{"pkg":"com.bank","certSha256":"$cert","domain":null}]}]""",
      String(MatchIndex.encode(listOf(IndexItem("b", "Bank", "u", listOf(Site(true, "bank.com")), listOf(AppLink(id, null))))), Charsets.UTF_8),
    )
  }

  @Test fun garbageIndexDecodesEmpty() {
    assertEquals(emptyList<IndexItem>(), MatchIndex.decode(byteArrayOf(1, 2, 3)))
    assertEquals(emptyList<IndexItem>(), MatchIndex.decode(null))
    assertEquals(emptyList<IndexItem>(), MatchIndex.decode(ByteArray(0)))
  }

  @Test fun hostileIndexNeverThrows() {
    val hostile = listOf(
      """{"not":"an array"}""",
      """[1,2]""",
      """[{"id":"x"}]""",
      """[{"id":"x","name":"n","username":"u","sites":[{"https":"yes","host":"h"}],"apps":[]}]""",
      """[{"id":"x","name":"n","username":"u","sites":[],"apps":[{"pkg":"p","certSha256":"short","domain":null}]}]""",
      "[".repeat(200_000) + "]".repeat(200_000),
      """[{"id":""" + "[".repeat(200_000) + "]".repeat(200_000) + "}]",
    )
    for (h in hostile) assertEquals(h.take(40), emptyList<IndexItem>(), MatchIndex.decode(h.toByteArray(Charsets.UTF_8)))
    assertEquals(emptyList<IndexItem>(), MatchIndex.decode(byteArrayOf(0xff.toByte(), 0xfe.toByte(), '['.code.toByte())))
  }

  @Test fun findAppliesTheSameRules() {
    val items = listOf(
      IndexItem("a", "App", "u", emptyList(), listOf(AppLink(id, "bank.com"))),
      IndexItem("s", "Site", "u", listOf(Site(true, "bank.com")), emptyList()),
    )
    assertEquals(emptyList<IndexItem>(), MatchIndex.find(items, Requester.App(id, "evil.com")))
    assertEquals(listOf(items[0]), MatchIndex.find(items, Requester.App(id, "bank.com")))
    assertEquals(emptyList<IndexItem>(), MatchIndex.find(items, Requester.Web(Site(false, "bank.com"))))
    assertEquals(listOf(items[1]), MatchIndex.find(items, Requester.Web(Site(true, "login.bank.com"))))
  }
}
