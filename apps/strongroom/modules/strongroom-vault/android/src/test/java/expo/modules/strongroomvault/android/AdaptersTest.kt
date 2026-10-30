package expo.modules.strongroomvault.android

import expo.modules.kotlin.exception.CodedException
import expo.modules.strongroomvault.core.AppId
import expo.modules.strongroomvault.core.AppLink
import expo.modules.strongroomvault.core.Entry
import expo.modules.strongroomvault.core.Matching
import expo.modules.strongroomvault.core.Site
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class AdaptersTest {
  private val app = AppLink(AppId("com.bank.app", "ab".repeat(32)), null)

  private fun login(sites: List<Any?>) =
    mapOf("type" to "login", "name" to "Bank", "username" to "me", "password" to "pw", "sites" to sites, "note" to "")

  private fun file(vararg blobs: ByteArray) = blobs.fold(ByteArray(0)) { f, b -> PendingFile.append(f, b) }

  @Test fun pendingFileRoundTrips() {
    val blobs = listOf(byteArrayOf(1, 2, 3), ByteArray(0), ByteArray(300) { it.toByte() })
    val (read, damaged) = PendingFile.split(file(*blobs.toTypedArray()))
    assertEquals(blobs.map { it.toList() }, read.map { it.toList() })
    assertEquals(0, damaged)
  }

  @Test fun emptyPendingFileHoldsNothing() {
    val (read, damaged) = PendingFile.split(ByteArray(0))
    assertTrue(read.isEmpty())
    assertEquals(0, damaged)
  }

  @Test fun tornLastSaveCountsAsOneLost() {
    val whole = file(byteArrayOf(1, 2, 3), byteArrayOf(4, 5, 6, 7))
    for (cut in 1..7) {
      val (read, damaged) = PendingFile.split(whole.copyOf(whole.size - cut))
      assertEquals("cut $cut", listOf(listOf<Byte>(1, 2, 3)), read.map { it.toList() })
      assertEquals("cut $cut", 1, damaged)
    }
  }

  @Test fun garbledLengthStopsWithOneLost() {
    val (read, damaged) = PendingFile.split(file(byteArrayOf(9)) + byteArrayOf(0x7f, -1, -1, -1, 1, 2))
    assertEquals(listOf(listOf<Byte>(9)), read.map { it.toList() })
    assertEquals(1, damaged)
    assertEquals(1, PendingFile.split(byteArrayOf(-1, -1, -1, -1)).second)
  }

  @Test fun typedSiteWithoutSchemeIsHttps() {
    assertEquals(Site(true, "example.com"), EntryInput.site("example.com"))
    assertEquals(Matching.siteFromUrl("https://example.com"), EntryInput.site("  Example.COM. "))
    assertEquals(Site(false, "example.com"), EntryInput.site("http://example.com/login"))
    assertNull(EntryInput.site("not a site"))
    assertNull(EntryInput.site("ftp://example.com"))
  }

  @Test fun savingAnExistingLoginKeepsItsApps() {
    val stored = Entry.Login("Bank", "me", "old", listOf(Site(true, "old.example")), listOf(app), "", 1)
    val saved = EntryInput.toEntry(login(listOf("bank.example", "")), stored) as Entry.Login
    assertEquals(listOf(app), saved.apps)
    assertEquals(listOf(Site(true, "bank.example")), saved.sites)
    assertEquals("pw", saved.password)
  }

  @Test fun aNewLoginHasNoApps() {
    assertTrue((EntryInput.toEntry(login(emptyList()), null) as Entry.Login).apps.isEmpty())
    assertTrue((EntryInput.toEntry(login(emptyList()), Entry.Note("n", "t", 1)) as Entry.Login).apps.isEmpty())
  }

  @Test fun anInvalidSiteIsRefused() {
    try {
      EntryInput.toEntry(login(listOf("bank.example", "not a site")), null)
      fail("expected BAD_SITE")
    } catch (e: CodedException) {
      assertEquals("BAD_SITE", e.code)
      assertEquals("That website address isn't valid. Check it and try again.", e.message)
    }
  }

  @Test fun cardExpiryArrivesAsJsNumbers() {
    val input = mapOf(
      "type" to "card", "name" to "Visa", "holder" to "Me", "number" to "4111 1111 1111 1111",
      "expMonth" to 7.0, "expYear" to null, "cvc" to "123", "note" to "",
    )
    val card = EntryInput.toEntry(input, null) as Entry.Card
    assertEquals(7, card.expMonth)
    assertNull(card.expYear)
  }
}
