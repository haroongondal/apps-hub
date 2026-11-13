package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LedgerTest {
  private val min = 60_000L
  private val t0 = 1_700_000_000_000L
  private val store = MemoryLedgerStore()
  private var owner: String? = null
  private val ledger = Ledger(store, { owner })
  private var nextItem = 1L

  private fun debit(amount: String = "1,500.00", account: String = "0847-1***2310") =
    "Dear Customer,\nYour Debit Card against A/C: $account is charged for PKR $amount on 12-Nov-26 at 16:23:38 at SHAAFI INTERNATIONAL HOSPIslamabad PK."
  private fun credit(amount: String, account: String = "0847-1***2310") =
    "Dear Customer,\nPKR $amount Credited to your A/C: $account on 13-Nov-26 at 12:02:54\nBal: Reply with AB"
  private fun ubl(amount: String = "50,000", txId: String = "7224343340") =
    "PKR $amount received from HAROON MUKHTAR* in your UBL A/C *1733 on 01-OCT-2026 21:03 via your Raast ID. Tx ID $txId. For info 111825888."

  private fun item(text: String, channel: Channel, at: Long) = ledger.onItem(nextItem++, text, channel, at)

  @Test fun smsAndNotificationMerge() {
    val a = item(debit(), Channel.SMS_NOTIFICATION, t0)
    val b = item(debit(), Channel.SMS, t0 + 2 * min)
    assertNotNull(a)
    assertEquals(a, b)
    assertEquals(1, store.txns.size)
    assertEquals(setOf(Channel.SMS, Channel.SMS_NOTIFICATION), store.txns.values.single().channels)
  }

  @Test fun mergedTxnKeepsEarliestSourceTime() {
    item(debit(), Channel.SMS, t0 + 2 * min)
    item(debit(), Channel.SMS_NOTIFICATION, t0)
    assertEquals(t0, store.txns.values.single().at)
  }

  @Test fun sameChannelNeverMerges() {
    val a = item(debit(), Channel.SMS, t0)
    val b = item(debit(), Channel.SMS, t0 + min)
    assertNotEquals(a, b)
    assertEquals(2, store.txns.size)
  }

  @Test fun outsideWindowNoMerge() {
    item(debit(), Channel.SMS_NOTIFICATION, t0)
    item(debit(), Channel.SMS, t0 + 11 * min)
    assertEquals(2, store.txns.size)
  }

  @Test fun differentAccountNoMerge() {
    item(debit(), Channel.SMS_NOTIFICATION, t0)
    item(debit(account = "0847-1***9999"), Channel.SMS, t0 + min)
    assertEquals(2, store.txns.size)
  }

  @Test fun txIdMergesAcrossDays() {
    val a = item(ubl(), Channel.SMS_NOTIFICATION, t0)
    val b = item(ubl(), Channel.SMS, t0 + 3 * 86_400_000L)
    assertEquals(a, b)
    assertEquals(1, store.txns.size)
  }

  @Test fun differentTxIdsNeverMerge() {
    item(ubl(txId = "111"), Channel.SMS_NOTIFICATION, t0)
    item(ubl(txId = "222"), Channel.SMS, t0 + min)
    assertEquals(2, store.txns.size)
  }

  @Test fun sourceWithoutTxIdAdoptsIt() {
    val cut = ubl().substringBefore(" Tx ID")
    val a = item(cut, Channel.SMS_NOTIFICATION, t0)
    assertNull(store.get(a!!)!!.txId)
    assertEquals(a, item(ubl(), Channel.SMS, t0 + min))
    assertEquals("7224343340", store.get(a)!!.txId)
  }

  @Test fun ownByName() {
    owner = "Haroon Mukhtar"
    val id = item(ubl(), Channel.SMS, t0)!!
    assertTrue(store.get(id)!!.own)
    assertFalse(store.get(id)!!.ownSet)
  }

  @Test fun notOwnWithoutName() {
    val id = item(ubl(), Channel.SMS, t0)!!
    assertFalse(store.get(id)!!.own)
  }

  @Test fun nameMatchingIgnoresPunctuationCaseAndSpaces() {
    assertTrue(OwnTransfer.nameMatches("HAROON MUKHTAR*", "Haroon  Mukhtar"))
    assertFalse(OwnTransfer.nameMatches("HAROON MUKHTAR", "Haroon Ali"))
    assertFalse(OwnTransfer.nameMatches(null, "Haroon"))
    assertFalse(OwnTransfer.nameMatches("*", ""))
  }

  @Test fun pairsOwnTransfer() {
    val out = item(debit("50,000.00"), Channel.SMS, t0)!!
    val inn = item(ubl("50,000", "1"), Channel.SMS, t0 + 20 * min)!!
    for (id in listOf(out, inn)) {
      assertTrue(store.get(id)!!.own)
      assertEquals(minOf(out, inn), store.get(id)!!.pairId)
      assertFalse(store.get(id)!!.ownSet)
    }
  }

  @Test fun noPairBeyondThirtyMinutes() {
    val out = item(debit("50,000.00"), Channel.SMS, t0)!!
    val inn = item(ubl("50,000", "1"), Channel.SMS, t0 + 31 * min)!!
    assertFalse(store.get(out)!!.own)
    assertFalse(store.get(inn)!!.own)
    assertNull(store.get(inn)!!.pairId)
  }

  @Test fun noPairWithinOneAccount() {
    val out = item(debit("50,000.00"), Channel.SMS, t0)!!
    val inn = item(credit("50,000.00"), Channel.SMS, t0 + 5 * min)!!
    assertFalse(store.get(out)!!.own)
    assertFalse(store.get(inn)!!.own)
  }

  @Test fun ownerOverrideWins() {
    val out = item(debit("50,000.00"), Channel.SMS, t0)!!
    val inn = item(ubl("50,000", "1"), Channel.SMS, t0 + 20 * min)!!
    ledger.setOwnTransfer(inn, false)
    for (id in listOf(out, inn)) {
      val t = store.get(id)!!
      assertFalse(t.own)
      assertTrue(t.ownSet)
      assertNull(t.pairId)
    }
    // A later matching transaction must not take either side back.
    val again = item(credit("50,000.00", "0000-0***4444"), Channel.SMS, t0 + 25 * min)!!
    assertFalse(store.get(again)!!.own)
    assertFalse(store.get(out)!!.own)
  }

  @Test fun ownerOverrideFromTheLowerIdSideAlsoUnlinksPartner() {
    val out = item(debit("50,000.00"), Channel.SMS, t0)!!
    val inn = item(ubl("50,000", "1"), Channel.SMS, t0 + min)!!
    ledger.setOwnTransfer(minOf(out, inn), false)
    assertFalse(store.get(maxOf(out, inn))!!.own)
  }

  @Test fun ownerCanMarkOwn() {
    val id = item(ubl(), Channel.SMS, t0)!!
    ledger.setOwnTransfer(id, true)
    assertTrue(store.get(id)!!.own)
    assertTrue(store.get(id)!!.ownSet)
  }

  @Test fun sameItemOnce() {
    assertNotNull(ledger.onItem(7, debit(), Channel.SMS, t0))
    assertNull(ledger.onItem(7, debit(), Channel.SMS, t0))
    assertEquals(1, store.txns.size)
  }

  @Test fun nonTransactionTextIsIgnored() {
    assertNull(item("OTP 123456 for PKR 25,000 at Daraz", Channel.SMS, t0))
    assertTrue(store.txns.isEmpty())
  }
}
