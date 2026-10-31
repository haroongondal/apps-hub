package expo.modules.strongroomvault.android

import expo.modules.kotlin.exception.CodedException
import expo.modules.strongroomvault.core.AppId
import expo.modules.strongroomvault.core.AppLink
import expo.modules.strongroomvault.core.CardFields
import expo.modules.strongroomvault.core.DetectedForm
import expo.modules.strongroomvault.core.Entry
import expo.modules.strongroomvault.core.Matching
import expo.modules.strongroomvault.core.PendingSave
import expo.modules.strongroomvault.core.Requester
import expo.modules.strongroomvault.core.Saves
import expo.modules.strongroomvault.core.Sealer
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

  private val copying = object : Sealer {
    override fun seal(plain: ByteArray) = plain.copyOf()

    override fun open(sealed: ByteArray) = sealed.copyOf()
  }

  private fun pending(user: String) = Saves.seal(copying, PendingSave(Requester.Web(Site(true, "example.com")), "Example", user, "pw-$user", 1))!!

  // The first byte says what the device key would do with the blob: A opens to the rest, L is gone for good, R failed for now.
  private fun blob(kind: Char, body: ByteArray = ByteArray(0)) = byteArrayOf(kind.code.toByte()) + body

  private val deviceKey: (ByteArray) -> PendingPlan.Open = { b ->
    when (b[0].toInt().toChar()) {
      'A' -> PendingPlan.Open.Plain(b.copyOfRange(1, b.size))
      'L' -> PendingPlan.Open.Lost
      else -> PendingPlan.Open.Retry
    }
  }

  @Test fun pendingPlanAppliesWhatOpensKeepsWhatMayOpenLaterAndCountsOnlyWhatNeverWill() {
    val keep1 = blob('R', byteArrayOf(1))
    val keep2 = blob('R', byteArrayOf(2))
    val blobs = listOf(blob('A', pending("a")), keep1, blob('L'), blob('A', "not a save".toByteArray()), keep2, blob('A', pending("b")))
    val plan = PendingPlan.of(PendingFile.join(blobs), deviceKey)
    assertEquals(listOf("a", "b"), plan.apply.map { it.username })
    assertEquals(listOf(keep1, keep2).map { it.toList() }, plan.keep.map { it.toList() })
    assertEquals(2, plan.lost)
  }

  @Test fun aPhoneThatLockedMidUnlockLosesNoSave() {
    val blobs = listOf(blob('R', pending("a")), blob('R', pending("b")))
    val plan = PendingPlan.of(PendingFile.join(blobs), deviceKey)
    assertTrue(plan.apply.isEmpty())
    assertEquals(0, plan.lost)
    assertEquals(blobs.map { it.toList() }, PendingFile.split(PendingFile.join(plan.keep)).first.map { it.toList() })
  }

  @Test fun aTornTailIsLostWhileTheRestStillApplies() {
    val kept = blob('R')
    val file = PendingFile.join(listOf(blob('A', pending("a")), kept)) + byteArrayOf(0, 0, 0, 9, 1)
    val plan = PendingPlan.of(file, deviceKey)
    assertEquals(listOf("a"), plan.apply.map { it.username })
    assertEquals(listOf(kept.toList()), plan.keep.map { it.toList() })
    assertEquals(1, plan.lost)
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

  @Test fun fillValuesFormatCardExpiryAndDropEmptyFields() {
    val card = Entry.Card("Visa", "", "4111111111111111", 7, 2029, "123", "", 0)
    assertEquals(
      mapOf("number" to "4111111111111111", "cvc" to "123", "expMonth" to "07", "expYear" to "2029", "expDate" to "07/29"),
      FillValues.of(card),
    )
    assertEquals(mapOf("number" to "4111111111111111", "cvc" to "123", "expMonth" to "07"), FillValues.of(card.copy(expYear = null)))
    assertEquals(mapOf("password" to "pw"), FillValues.of(Entry.Login("Bank", "", "pw", emptyList(), emptyList(), "", 0)))
    assertEquals(emptyMap<String, String>(), FillValues.of(Entry.Note("n", "secret", 0)))
  }

  @Test fun fillRolesFollowTheDetectedForm() {
    val form = DetectedForm(username = 0, password = null, newPassword = 1, card = CardFields(2, null, null, null, 3, 4))
    assertEquals(mapOf("username" to 0), FillValues.loginRoles(form))
    assertEquals(mapOf("number" to 2, "expDate" to 3, "cvc" to 4), FillValues.cardRoles(form))
    assertEquals(emptyMap<String, Int>(), FillValues.cardRoles(form.copy(card = null)))
  }
}
