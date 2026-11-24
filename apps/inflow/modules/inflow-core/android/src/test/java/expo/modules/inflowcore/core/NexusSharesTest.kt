package expo.modules.inflowcore.core

import expo.modules.inflowcore.applink.SiblingPackages
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NexusSharesTest {
  private val nexus = arrayOf("com.haroon.pdfeditor")

  @Test fun onlyAUidHoldingNexusAloneIsNexus() {
    assertEquals("com.haroon.pdfeditor", SiblingPackages.NEXUS)
    assertTrue(NexusShares.callerIsNexus(nexus))
    for (other in listOf(null, emptyArray(), arrayOf(SiblingPackages.HALO), arrayOf(SiblingPackages.DEPUTY), arrayOf(SiblingPackages.INFLOW), arrayOf(SiblingPackages.NEXUS, SiblingPackages.HALO), arrayOf(SiblingPackages.HALO, SiblingPackages.NEXUS), arrayOf("com.haroon.pdfeditor.debug"))) {
      assertFalse(other?.toList().toString(), NexusShares.callerIsNexus(other))
    }
  }

  @Test fun anotherCallerGetsNothingEvenWithTheSwitchOn() {
    for (other in listOf(null, arrayOf(SiblingPackages.HALO), arrayOf(SiblingPackages.DEPUTY), arrayOf(SiblingPackages.NEXUS, SiblingPackages.DEPUTY))) {
      assertNull(NexusShares.since(other, "1", "0"))
    }
  }

  @Test fun theSwitchOffOrUnknownServesNothing() {
    for (meta in listOf(null, "", "0", "true", "on")) assertNull(meta, NexusShares.since(nexus, meta, "0"))
    assertEquals(0L, NexusShares.since(nexus, "1", "0"))
  }

  @Test fun onlyAWholeSinceIdFromZeroToTwoToThe53IsAccepted() {
    assertEquals(42L, NexusShares.since(nexus, "1", "42"))
    assertEquals(NexusShares.MAX_SAFE_LONG, NexusShares.since(nexus, "1", "9007199254740991"))
    for (bad in listOf(null, "", "-1", "abc", "1.5", "+3", " 3", "0x10", "9007199254740992", "99999999999999999999", "١٢")) assertNull(bad, NexusShares.since(nexus, "1", bad))
  }

  @Test fun anAskRowIsCleanedAndCappedAndABadOneIsDropped() {
    val ok = NexusAskItem(41, "Messages", "Ammi", "Dinner at 8?\nBring bread.", 1_764_000_000_000)
    assertArrayEquals(arrayOf<Any?>(41L, "Messages", "Ammi", "Dinner at 8?\nBring bread.", 1_764_000_000_000L), NexusShares.askRow(ok))
    assertEquals("a b", NexusShares.askRow(ok.copy(text = "a\u0000b"))!![3])
    assertNull(NexusShares.askRow(ok.copy(sender = "  "))!![2])
    assertNull(NexusShares.askRow(ok.copy(sender = null))!![2])
    for (bad in listOf(ok.copy(id = 0), ok.copy(id = -1), ok.copy(id = NexusShares.MAX_SAFE_LONG + 1), ok.copy(text = " \n "), ok.copy(app = " "), ok.copy(at = -1))) assertNull(NexusShares.askRow(bad))
  }

  @Test fun textIsCutAt4000WithoutSplittingAnEmoji() {
    val row = NexusShares.askRow(NexusAskItem(1, "Gmail", null, "a".repeat(5000), 1))!!
    assertEquals(4000, (row[3] as String).length)
    val emoji = "a".repeat(3999) + "😀" + "b"
    assertEquals("a".repeat(3999), NexusShares.askRow(NexusAskItem(1, "Gmail", null, emoji, 1))!![3])
  }

  @Test fun idRowsKeepOnlyPositiveSafeIds() {
    assertArrayEquals(arrayOf<Any?>(7L), NexusShares.idRow(7))
    assertNull(NexusShares.idRow(0))
    assertNull(NexusShares.idRow(NexusShares.MAX_SAFE_LONG + 1))
  }

  private val now = 1_764_000_000_000L
  private val day = 86_400_000L
  private fun txn(id: Long = 7, dir: Direction = Direction.OUT, minor: Long = 420_000, at: Long = now - day, own: Boolean = false, account: String = "Meezan 1234", counterparty: String? = "IMTIAZ", label: String? = "Imtiaz") =
    Txn(id, dir, minor, "PKR", account, counterparty, null, at, own, false, null, emptySet(), label = label)

  @Test fun aDebitIsMoneyOutNotOwnInsideSixtyDays() {
    assertArrayEquals(arrayOf<Any?>(7L, 420_000L, now - day, "Imtiaz", "Meezan ****1234"), NexusShares.debitRow(txn(), now))
    assertEquals(now - 60 * day, NexusShares.debitsFrom(now))
    assertEquals(now - 60 * day, NexusShares.debitRow(txn(at = now - 60 * day), now)!![2])
    for (bad in listOf(txn(at = now - 60 * day - 1), txn(dir = Direction.IN), txn(own = true), txn(minor = 0), txn(minor = -5), txn(id = 0))) assertNull(NexusShares.debitRow(bad, now))
  }

  @Test fun theMerchantIsTheShownNameCutTo80WithoutControlCharacters() {
    assertEquals("IMTIAZ", NexusShares.debitRow(txn(label = null), now)!![3])
    assertEquals("", NexusShares.debitRow(txn(label = null, counterparty = null), now)!![3])
    assertEquals("Shop A B", NexusShares.debitRow(txn(label = "Shop\u0007A\nB"), now)!![3])
    assertEquals(80, (NexusShares.debitRow(txn(label = "x".repeat(200)), now)!![3] as String).length)
  }

  @Test fun theAccountLabelNeverHoldsMoreThanFourDigits() {
    assertEquals("Meezan ****1234", NexusShares.accountLabel("Meezan 1234"))
    assertEquals("****1234", NexusShares.accountLabel("4111111111111234"))
    assertEquals("Card ****1234", NexusShares.accountLabel("Card 4111 1111 1111 1234"))
    assertEquals("Card ****1234", NexusShares.accountLabel("Card XXXX-XXXX-XXXX-1234"))
    assertEquals("PK SCBL ****6702", NexusShares.accountLabel("PK36SCBL0000001123456702"))
    assertEquals("PK SCBL ****6702", NexusShares.accountLabel("PK36 SCBL 0000 0011 2345 6702"))
    assertEquals("HBL ****12", NexusShares.accountLabel("HBL 12"))
    assertEquals("Meezan card", NexusShares.accountLabel("Meezan card"))
    assertEquals("", NexusShares.accountLabel(""))
    for (raw in listOf("4111111111111234", "PK36SCBL0000001123456702", "PK36 SCBL 0000 0011 2345 6702", "١٢٣٤٥٦٧٨٩٠١٢", "acct 12-34-56-78-90")) {
      assertTrue(raw, NexusShares.accountLabel(raw).count(Char::isDigit) <= 4)
    }
    assertTrue(NexusShares.accountLabel("B".repeat(300) + " 1234").length <= NexusShares.MAX_LABEL)
  }
}
