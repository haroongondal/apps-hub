package expo.modules.strongroomvault.core

import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class GoogleImportTest {
  private val header = "name,url,username,password,note\r\n"
  private val flagPrefix = "Imported twice with different passwords. Delete the wrong one.\n"
  private val hash = "01".repeat(32)
  private val hashB64 = Base64.getEncoder().encodeToString(ByteArray(32) { 1 })

  private fun import(body: String, now: Long = 42L) = GoogleImport.parse(header + body, now)

  private fun importError(csv: String) = assertThrows(ImportError::class.java) { GoogleImport.parse(csv, 0L) }

  @Test fun androidUrlBecomesAppId() {
    val r = import("Example app,android://$hashB64@com.example/,me,pw,\r\n")
    assertEquals(listOf(AppLink(AppId("com.example", hash), null)), r.logins.single().apps)
    assertTrue(r.logins.single().sites.isEmpty())
  }

  @Test fun standardAndUrlSafeBase64BothDecode() {
    val bytes = ByteArray(32) { 0xfb.toByte() }
    val standard = Base64.getEncoder().encodeToString(bytes)
    val urlSafe = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    assertTrue(standard.contains('/') && standard.contains('+'))
    assertTrue(urlSafe.contains('_') && urlSafe.contains('-'))
    for (b64 in listOf(standard, urlSafe)) {
      val r = import("x,android://$b64@com.example/,me,pw,\r\n")
      assertEquals(b64, listOf(AppLink(AppId("com.example", "fb".repeat(32)), null)), r.logins.single().apps)
    }
  }

  @Test fun undecodableCertGivesNoAppId() {
    val r = import("x,android://not-base64!@com.example/,me,pw,\r\n")
    assertEquals(1, r.logins.size)
    assertTrue(r.logins.single().apps.isEmpty())
  }

  @Test fun wrongLengthHashAndOddPackagesGiveNoAppId() {
    val short = Base64.getEncoder().encodeToString(ByteArray(31) { 1 })
    val long = Base64.getEncoder().encodeToString(ByteArray(33) { 1 })
    for (url in listOf(
      "android://$short@com.example/",
      "android://$long@com.example/",
      "android://@com.example/",
      "android://$hashB64@/",
      "android://$hashB64@bad pkg/",
      "android://$hashB64@com.exa;mple/",
      "android://$hashB64",
    )) {
      val r = import("x,$url,me,pw,\r\n")
      assertEquals(url, 1, r.logins.size)
      assertTrue(url, r.logins.single().apps.isEmpty())
    }
  }

  @Test fun webUrlBecomesSite() {
    val l = import("x,https://accounts.example.com/login,me,pw,\r\n").logins.single()
    assertEquals(listOf(Site(true, "accounts.example.com")), l.sites)
    assertTrue(l.apps.isEmpty())
  }

  @Test fun otherUrlsImportWithNoSiteAndNoApp() {
    val r = import("a,ftp://files.example.com/,me,pw1,\r\nb,example.com,me,pw2,\r\nc,,me,pw3,\r\n")
    assertEquals(3, r.logins.size)
    assertEquals(0, r.merged)
    assertEquals(0, r.flagged)
    assertTrue(r.logins.all { it.sites.isEmpty() && it.apps.isEmpty() })
    assertEquals(listOf("Imported from ftp://files.example.com/", "Imported from example.com", ""), r.logins.map { it.note })
  }

  @Test fun unlinkedLoginsOnDifferentUrlsAreNotMerged() {
    val r = import("Router,192.168.1.1,admin,admin,\r\nNAS,192.168.1.2,admin,admin,\r\n")
    assertEquals(2, r.logins.size)
    assertEquals(0, r.merged)
    assertEquals(0, r.flagged)
  }

  @Test fun unlinkedLoginsOnDifferentUrlsAreNotFlagged() {
    val r = import("Bank A,ftp://a.example/,me,pw1,\r\nBank B,b.example,me,pw2,\r\n")
    assertEquals(2, r.logins.size)
    assertEquals(0, r.flagged)
    assertTrue(r.logins.all { !it.note.startsWith(flagPrefix) })
  }

  @Test fun unlinkedLoginsWithBlankUrlsAreKeptApartByName() {
    val r = import("A,,me,pw,\r\nB,,me,pw,\r\nC,,me,other,\r\n")
    assertEquals(3, r.logins.size)
    assertEquals(0, r.merged)
    assertEquals(0, r.flagged)
    assertEquals(listOf("", "", ""), r.logins.map { it.note })
  }

  @Test fun identicalUnlinkedLoginsStillMergeAndSameUrlDifferentPasswordIsFlagged() {
    val same = import("Router,192.168.1.1,admin,admin,\r\nRouter,192.168.1.1,admin,admin,\r\n")
    assertEquals(1, same.logins.size)
    assertEquals(1, same.merged)
    val blank = import("A,,me,pw,\r\nA,,me,pw,\r\n")
    assertEquals(1, blank.logins.size)
    assertEquals(1, blank.merged)
    val clash = import("Router,192.168.1.1,admin,one,\r\nRouter,192.168.1.1,admin,two,\r\n")
    assertEquals(2, clash.logins.size)
    assertEquals(2, clash.flagged)
    assertEquals(flagPrefix + "Imported from 192.168.1.1", clash.logins[0].note)
  }

  @Test fun unlinkedLoginKeepsItsUrlOnItsOwnNoteLine() {
    val r = import("Router,192.168.1.1,admin,pw1,my note\r\nNas,,admin,pw2,\r\n")
    assertEquals("my note\nImported from 192.168.1.1", r.logins[0].note)
    assertEquals("", r.logins[1].note)
  }

  @Test fun mergedDuplicatesKeepEveryDistinctNote() {
    val r = import("a,https://example.org/,me,pw,first\r\nb,https://example.org/,me,pw,second\r\nc,https://example.org/,me,pw,first\r\nd,https://example.org/,me,pw,\r\n")
    assertEquals(1, r.logins.size)
    assertEquals(3, r.merged)
    assertEquals("first\nsecond", r.logins.single().note)
    val unlinked = import("R,10.0.0.1,me,pw,n1\r\nR,10.0.0.1,me,pw,n2\r\n").logins.single()
    assertEquals("n1\nn2\nImported from 10.0.0.1", unlinked.note)
  }

  @Test fun androidUrlSplitsOnTheFirstAt() {
    val r = import("x,android://$hashB64@com.example/login@home,me,pw,\r\n")
    assertEquals(listOf(AppLink(AppId("com.example", hash), null)), r.logins.single().apps)
  }

  @Test fun rowWithMoreCellsThanTheHeaderIsRefusedWithoutEchoingIt() {
    val message = "Row 2 of this file has more columns than its header, so a value may be split. Export again from Google Password Manager."
    val e = importError(header + "a,https://example.org/,me,pw,\r\n\r\nx,https://example.org/,me,hunter2,ss,note\r\n")
    assertEquals(message, e.message)
    assertFalse(e.message!!.contains("hunter2"))
    assertEquals(message.replace("Row 2", "Row 1"), importError(header + "x,https://example.org/,me,pa,ss,note\r\n").message)
  }

  @Test fun exactDuplicatesMerge() {
    val r = import("a,https://example.org/,me,pw,\r\nb,https://example.org/x,me,pw,note\r\nc,https://example.org,me,pw,\r\n")
    assertEquals(1, r.logins.size)
    assertEquals(2, r.merged)
    assertEquals(0, r.flagged)
    assertEquals("a", r.logins.single().name)
  }

  @Test fun samePlaceSameUserDifferentPasswordIsFlagged() {
    val r = import("a,https://example.org/,me,pw1,keep this\r\nb,https://example.org/,me,pw2,\r\nc,https://example.org/,you,pw3,\r\n")
    assertEquals(3, r.logins.size)
    assertEquals(2, r.flagged)
    assertEquals(0, r.merged)
    assertEquals(flagPrefix + "keep this", r.logins[0].note)
    assertEquals(flagPrefix, r.logins[1].note)
    assertEquals("", r.logins[2].note)
  }

  @Test fun flaggedGroupCountsEveryMemberAndStillMergesCopies() {
    val r = import("a,https://example.org/,me,pw1,\r\nb,https://example.org/,me,pw2,\r\nc,https://example.org/,me,pw3,\r\nd,https://example.org/,me,pw2,\r\n")
    assertEquals(3, r.logins.size)
    assertEquals(1, r.merged)
    assertEquals(3, r.flagged)
    assertTrue(r.logins.all { it.note.startsWith(flagPrefix) })
  }

  @Test fun sameUserOnDifferentSitesIsNotFlagged() {
    val r = import("a,https://one.example/,me,pw1,\r\nb,https://two.example/,me,pw2,\r\n")
    assertEquals(2, r.logins.size)
    assertEquals(0, r.flagged)
  }

  @Test fun emptyUsernameAndPathlessUrlImport() {
    val l = import("example.org,https://example.org,,pw,\r\n").logins.single()
    assertEquals("", l.username)
    assertEquals(listOf(Site(true, "example.org")), l.sites)
  }

  @Test fun wrongFileThrowsImportError() {
    val message = "This file isn't a Google Passwords export. Export again from Google Password Manager and pick that file."
    assertEquals(message, importError("title,address\r\nx,y\r\n").message)
    assertEquals(message, importError("name,url,username\r\nx,y,z\r\n").message)
    assertEquals(message, importError("").message)
  }

  @Test fun unterminatedQuoteIsADamagedFileAndNeverEchoesTheContent() {
    val e = importError(header + "x,https://example.org/,me,\"hunter2-secret,\r\n")
    assertEquals("This file is damaged: a quoted field never ends. Export again from Google Password Manager.", e.message)
    assertFalse(e.message!!.contains("hunter2"))
  }

  @Test fun headerMatchesAfterTrimmingInAnyCaseAndOrder() {
    val l = GoogleImport.parse("\uFEFF Password ,USERNAME,Url, name\r\npw,me,https://example.org/,Example\r\n", 1L).logins.single()
    assertEquals(Entry.Login("Example", "me", "pw", listOf(Site(true, "example.org")), emptyList(), "", 1L), l)
  }

  @Test fun noteColumnIsOptional() {
    val l = GoogleImport.parse("name,url,username,password\r\nx,https://example.org/,me,pw\r\n", 1L).logins.single()
    assertEquals("", l.note)
  }

  @Test fun blankLinesAreSkippedAndShortRowsArePadded() {
    val csv = "\r\nname,url,username,password,note\r\n\r\nx,https://example.org/,me\r\n\r\ny,https://example.net/,you,pw,n\r\n\r\n"
    val r = GoogleImport.parse(csv, 1L)
    assertEquals(2, r.logins.size)
    assertEquals("", r.logins[0].password)
    assertEquals("pw", r.logins[1].password)
    assertEquals("n", r.logins[1].note)
  }

  @Test fun nameFallsBackToRegistrableDomainThenHostThenPackage() {
    val r = import(
      ",https://accounts.example.com/login,me,pw1,\r\n" +
        ",https://localhost:8080/,me,pw2,\r\n" +
        ",android://$hashB64@com.example.app/,me,pw3,\r\n" +
        ",,me,pw4,\r\n" +
        "  ,https://example.org,me,pw5,\r\n",
    )
    assertEquals(listOf("example.com", "localhost:8080", "com.example.app", "", "example.org"), r.logins.map { it.name })
  }

  @Test fun updatedAtIsNowAndNamesAreKeptVerbatim() {
    val l = import(" My Bank ,https://example.org/,me,pw,\r\n", now = 1_700_000_000_000L).logins.single()
    assertEquals(" My Bank ", l.name)
    assertEquals(1_700_000_000_000L, l.updatedAt)
  }

  @Test fun redactedFixtureParses() {
    val text = javaClass.getResourceAsStream("/google-export-redacted.csv")!!.use { String(it.readBytes(), Charsets.UTF_8) }
    assertTrue(text.startsWith("\uFEFF"))
    assertTrue(text.contains("\r\n"))
    val dataRows = Csv.parse(text).size - 1
    val r = GoogleImport.parse(text, 5L)
    assertEquals(9, dataRows)
    assertEquals(1, r.merged)
    assertEquals(2, r.flagged)
    assertEquals(dataRows - r.merged, r.logins.size)
    assertEquals(
      listOf("example.org", "accounts.example.com", "Team wiki", "Example app", "Broken hash", "Mail", "Forum", "Forum"),
      r.logins.map { it.name },
    )
    assertEquals(listOf(Site(true, "example.org")), r.logins[0].sites)
    assertEquals("", r.logins[1].username)
    assertEquals("Shared with \"ops\", rotate monthly.\nSecond line of the note", r.logins[2].note)
    assertEquals(listOf(AppLink(AppId("com.example.app", hash), null)), r.logins[3].apps)
    assertTrue(r.logins[4].apps.isEmpty() && r.logins[4].sites.isEmpty())
    assertEquals("Imported from android://not-base64!@com.example.broken/", r.logins[4].note)
    assertTrue(r.logins[6].note.startsWith(flagPrefix) && r.logins[7].note.startsWith(flagPrefix))
    assertTrue(r.logins.all { it.password.startsWith("pw") })
  }
}
