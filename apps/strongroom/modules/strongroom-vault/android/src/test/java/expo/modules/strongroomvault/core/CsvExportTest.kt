package expo.modules.strongroomvault.core

import org.junit.Assert.assertEquals
import org.junit.Test

class CsvExportTest {
  private val app = AppLink(AppId("com.example.app", "fb".repeat(32)), "bank.example")
  private val linked = Entry.Login(
    "Example", "me@example.com", "p,a\"ss\nword", listOf(Site(true, "example.com"), Site(false, "old.example.com")), listOf(app), "line one\r\nline two", 5,
  )
  private val bare = Entry.Login("Router", "admin", "=1+2", emptyList(), emptyList(), "", 5)
  private val card = Entry.Card("Visa, work", "A. Holder", "4111 1111 1111 9876", 3, 2031, "321", "the \"blue\" one", 5)
  private val undated = Entry.Card("Store card", "", "6000", null, null, "", "", 5)
  private val note = Entry.Note("Wi-Fi", "ssid: home\npass: x,y", 5)

  @Test fun googleColumnsComeFirstWithOneRowPerLink() {
    val rows = Csv.parse(CsvExport.csv(listOf(linked, note, Entry.Deleted(5))))
    assertEquals(listOf("name", "url", "username", "password", "note"), rows[0].take(5))
    assertEquals(
      listOf("https://example.com", "http://old.example.com", "android://" + "+/v7".repeat(10) + "+/s=@com.example.app/"),
      rows.filter { it[5] == "login" }.map { it[1] },
    )
    assertEquals(5, rows.size)
  }

  @Test fun roundTripsThroughTheImport() {
    val r = GoogleImport.parse(CsvExport.csv(listOf(linked, bare, card, undated, note)), 9)
    val one = linked.copy(sites = emptyList(), apps = emptyList(), updatedAt = 9)
    assertEquals(
      setOf(
        one.copy(sites = listOf(Site(true, "example.com"))),
        one.copy(sites = listOf(Site(false, "old.example.com"))),
        one.copy(apps = listOf(app)),
        bare.copy(updatedAt = 9),
      ),
      r.logins.toSet(),
    )
    assertEquals(setOf(card.copy(updatedAt = 9), undated.copy(updatedAt = 9), note.copy(updatedAt = 9)), r.cardsAndNotes.toSet())
    assertEquals(0, r.merged)
    assertEquals(0, r.flagged)
  }
}
