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

  @Test fun ownerNameChangedReevaluatesPastTransactions() {
    val id = item(ubl(), Channel.SMS, t0)!!
    assertFalse(store.get(id)!!.own)
    owner = "Haroon Mukhtar"
    ledger.ownerNameChanged(null)
    assertTrue(store.get(id)!!.own)
    assertFalse(store.get(id)!!.ownSet)
    owner = null
    ledger.ownerNameChanged("Haroon Mukhtar")
    assertFalse(store.get(id)!!.own)
  }

  @Test fun ownerNameChangeLeavesPairedAndHandSetAlone() {
    owner = "Haroon Mukhtar"
    val chosen = item(ubl(txId = "1"), Channel.SMS, t0)!!
    ledger.setOwnTransfer(chosen, false)
    val out = item(debit("50,000"), Channel.SMS, t0 + 40 * min)!!
    val into = item(credit("50,000", "9999"), Channel.SMS, t0 + 41 * min)!!
    val pairId = store.get(out)!!.pairId
    assertNotNull(pairId)
    owner = "Someone Else"
    ledger.ownerNameChanged("Haroon Mukhtar")
    assertFalse(store.get(chosen)!!.own)
    assertTrue(store.get(chosen)!!.ownSet)
    assertTrue(store.get(out)!!.own)
    assertTrue(store.get(into)!!.own)
    assertEquals(pairId, store.get(into)!!.pairId)
  }

  private fun alfalahPos(amount: String = "1,700.00") = Samples.ALFALAH_EMAIL.replace("1,700.00", amount)

  @Test fun emailMergesWithSmsByWindow() {
    val sms = item(debit("1,700.00"), Channel.SMS, t0)!!
    val email = item(alfalahPos(), Channel.EMAIL, t0 + 4 * min)
    assertEquals(sms, email)
    val t = store.txns.values.single()
    assertEquals(setOf(Channel.SMS, Channel.EMAIL), t.channels)
    assertEquals("FT263160G6MC4S12", t.txId)
  }

  @Test fun emailFillsMissingCounterparty() {
    val id = item(alfalahPos(), Channel.EMAIL, t0)!!
    assertNull(store.get(id)!!.counterparty)
    assertEquals(id, item(debit("1,700.00"), Channel.SMS, t0 + min))
    assertEquals("SHAAFI INTERNATIONAL HOSPIslamabad PK", store.get(id)!!.counterparty)
  }

  @Test fun mergeKeepsAnExistingCounterparty() {
    val id = item(debit("1,700.00"), Channel.SMS, t0)!!
    item(alfalahPos(), Channel.EMAIL, t0 + min)
    assertEquals("SHAAFI INTERNATIONAL HOSPIslamabad PK", store.get(id)!!.counterparty)
  }

  @Test fun ublEmailResolvesToKnownAccount() {
    item(ubl(), Channel.SMS, t0)
    val id = item(Samples.UBL_EMAIL, Channel.EMAIL, t0 + min)!!
    assertEquals("UBL 1733", store.get(id)!!.account)
  }

  @Test fun ublEmailWithNoKnownAccountKeepsPartial() {
    val id = item(Samples.UBL_EMAIL, Channel.EMAIL, t0)!!
    assertEquals("UBL 33", store.get(id)!!.account)
  }

  // --- AI money (R28)
  private fun aiMoney(
    amount: Long = 150_000, direction: Direction = Direction.OUT, own: Boolean = false, account: String? = "Alfalah 2310",
    counterparty: String? = "Dr Khan", category: String = "Health",
  ) = AiMoney(direction, own, amount, "PKR", account, counterparty, category)

  private fun ai(money: AiMoney, channel: Channel, at: Long) = ledger.onAi(nextItem++, money, channel, at)

  @Test fun aiOnPatternTxnSetsCategoryOnly() {
    val id = item(debit("1,500.00"), Channel.SMS, t0)!!
    val source = nextItem - 1
    assertEquals(id, ledger.onAi(source, aiMoney(amount = 999_900, direction = Direction.IN, account = "UBL 1733", category = "Health"), Channel.SMS, t0))
    val t = store.get(id)!!
    assertEquals(150_000L, t.amountMinor)
    assertEquals(Direction.OUT, t.direction)
    assertEquals("Alfalah 2310", t.account)
    assertEquals("Health", t.category)
    assertEquals("Dr Khan", t.label)
    assertEquals("SHAAFI INTERNATIONAL HOSPIslamabad PK", t.counterparty)
    assertFalse(t.byAi)
    assertEquals(1, store.txns.size)
  }

  @Test fun aiOnlyTxnCountsAndIsMarked() {
    val id = ai(aiMoney(amount = 50_000, counterparty = "Daraz", category = "Shopping"), Channel.NOTIFICATION, t0)!!
    val t = store.get(id)!!
    assertTrue(t.byAi)
    assertFalse(t.own)
    assertEquals(50_000L, t.amountMinor)
    assertEquals("Shopping", t.category)
    assertEquals("Daraz", t.label)
    assertEquals("Daraz", t.counterparty)
    assertEquals("Other account", t.account)
    assertEquals(setOf(Channel.NOTIFICATION), t.channels)
    assertEquals(id, store.txnOfItem(nextItem - 1))
  }

  @Test fun aiAccountMatchesAKnownAccountIgnoringCaseElseIsOtherAccount() {
    item(debit(), Channel.SMS, t0)
    val known = ai(aiMoney(amount = 700, account = "alfalah 2310"), Channel.NOTIFICATION, t0 + 20 * min)!!
    assertEquals("Alfalah 2310", store.get(known)!!.account)
    val unknown = ai(aiMoney(amount = 800, account = "Invented Bank 0000"), Channel.NOTIFICATION, t0 + 20 * min)!!
    assertEquals("Other account", store.get(unknown)!!.account)
    val none = ai(aiMoney(amount = 900, account = null), Channel.NOTIFICATION, t0 + 20 * min)!!
    assertEquals("Other account", store.get(none)!!.account)
  }

  @Test fun aiOnlyMergesWithSmsByDedup() {
    val sms = item(debit("1,500.00"), Channel.SMS, t0)!!
    val merged = ai(aiMoney(amount = 150_000, account = "Alfalah 2310", counterparty = "Shaafi Hospital", category = "Health"), Channel.NOTIFICATION, t0 + 4 * min)
    assertEquals(sms, merged)
    assertEquals(1, store.txns.size)
    val t = store.get(sms)!!
    assertEquals(setOf(Channel.SMS, Channel.NOTIFICATION), t.channels)
    assertEquals("Health", t.category)
    assertEquals("Shaafi Hospital", t.label)
    assertFalse(t.byAi)
    assertEquals("SHAAFI INTERNATIONAL HOSPIslamabad PK", t.counterparty)
  }

  @Test fun aiOnlyDoesNotMergeOnTheSameChannelOrAnotherAccount() {
    item(debit("1,500.00"), Channel.SMS, t0)
    ai(aiMoney(account = "Alfalah 2310"), Channel.SMS, t0 + min)
    ai(aiMoney(account = "UBL 1733"), Channel.NOTIFICATION, t0 + min)
    assertEquals(3, store.txns.size)
  }

  @Test fun aiOwnFlagNeverOverridesOwner() {
    val id = item(ubl(), Channel.SMS, t0)!!
    val source = nextItem - 1
    ledger.setOwnTransfer(id, false)
    ledger.onAi(source, aiMoney(amount = 5_000_000, direction = Direction.IN, own = true, account = "UBL 1733"), Channel.SMS, t0)
    val t = store.get(id)!!
    assertFalse(t.own)
    assertTrue(t.ownSet)
  }

  @Test fun aiOwnTransferMarksOwn() {
    val id = ai(aiMoney(amount = 50_000, own = true, account = null, counterparty = null, category = "Other"), Channel.NOTIFICATION, t0)!!
    assertTrue(store.get(id)!!.own)
    assertFalse(store.get(id)!!.ownSet)
    val pattern = item(ubl(txId = "55"), Channel.SMS, t0 + 40 * min)!!
    ledger.onAi(nextItem - 1, aiMoney(amount = 5_000_000, direction = Direction.IN, own = true, account = "UBL 1733"), Channel.SMS, t0)
    assertTrue(store.get(pattern)!!.own)
    assertFalse(store.get(pattern)!!.ownSet)
  }

  @Test fun aiNeverTakesOwnAwayFromAPatternTxn() {
    owner = "Haroon Mukhtar"
    val id = item(ubl(), Channel.SMS, t0)!!
    ledger.onAi(nextItem - 1, aiMoney(amount = 5_000_000, direction = Direction.IN, own = false, account = "UBL 1733"), Channel.SMS, t0)
    assertTrue(store.get(id)!!.own)
  }

  @Test fun aiOnlyTxnNeverPairsWithAnOppositeTxn() {
    val out = item(debit("50,000.00"), Channel.SMS, t0)!!
    val inn = ai(aiMoney(amount = 5_000_000, direction = Direction.IN, account = "Invented 1", counterparty = "Someone", category = "Other"), Channel.NOTIFICATION, t0 + 10 * min)!!
    assertFalse(store.get(out)!!.own)
    assertFalse(store.get(inn)!!.own)
    assertNull(store.get(inn)!!.pairId)
  }

  @Test fun aiForTheSameItemTwiceStaysOneTxn() {
    val source = nextItem++
    val a = ledger.onAi(source, aiMoney(amount = 700), Channel.NOTIFICATION, t0)
    val b = ledger.onAi(source, aiMoney(amount = 700, category = "Food"), Channel.NOTIFICATION, t0)
    assertEquals(a, b)
    assertEquals(1, store.txns.size)
    assertEquals("Food", store.get(a!!)!!.category)
  }

  @Test fun aiOwnerNameStillMarksAnAiOnlyTxnOwn() {
    owner = "Haroon Mukhtar"
    val id = ai(aiMoney(amount = 700, counterparty = "HAROON MUKHTAR"), Channel.NOTIFICATION, t0)!!
    assertTrue(store.get(id)!!.own)
    assertFalse(store.get(id)!!.ownSet)
  }

  @Test fun ownerNameChangeKeepsAnAiOwnMarkWithAnUnrelatedCounterparty() {
    val id = ai(aiMoney(amount = 50_000, own = true, counterparty = "Ali Traders", category = "Other"), Channel.NOTIFICATION, t0)!!
    assertTrue(store.get(id)!!.own)
    owner = "Haroon Mukhtar"
    ledger.ownerNameChanged(null)
    assertTrue(store.get(id)!!.own)
    owner = null
    ledger.ownerNameChanged("Haroon Mukhtar")
    assertTrue(store.get(id)!!.own)
  }

  @Test fun aiOnlyTxnOnAGmailNotificationYieldsToTheEmailsPattern() {
    val sms = item(debit("1,700.00"), Channel.SMS, t0)!!
    val notification = nextItem++
    val aiTxn = ledger.onAi(notification, aiMoney(amount = 170_000, account = null, counterparty = "Shaafi", category = "Health"), Channel.EMAIL_NOTIFICATION, t0 + 2 * min)!!
    assertNotEquals(sms, aiTxn)
    assertEquals("Other account", store.get(aiTxn)!!.account)
    assertEquals(sms, ledger.onItem(notification, alfalahPos(), Channel.EMAIL, t0 + 4 * min))
    assertEquals(1, store.txns.size)
    assertNull(store.get(aiTxn))
    assertEquals(setOf(Channel.SMS, Channel.EMAIL), store.get(sms)!!.channels)
    assertEquals(sms, store.txnOfItem(notification))
  }

  @Test fun aiTxnWithAnotherSourceOrAnOwnerDecisionIsNotDeletedByAPatternItem() {
    val notification = nextItem++
    val aiTxn = ledger.onAi(notification, aiMoney(amount = 170_000, account = null), Channel.EMAIL_NOTIFICATION, t0)!!
    store.setOwn(aiTxn, false, true, null)
    assertNull(ledger.onItem(notification, alfalahPos(), Channel.EMAIL, t0 + min))
    assertNotNull(store.get(aiTxn))
  }

  @Test fun aiTxnWithTwoSourcesIsNotDeletedByAPatternItemOnOneOfThem() {
    val a = nextItem++
    val b = nextItem++
    val aiTxn = ledger.onAi(a, aiMoney(amount = 170_000, account = null), Channel.NOTIFICATION, t0)!!
    assertEquals(aiTxn, ledger.onAi(b, aiMoney(amount = 170_000, account = null), Channel.EMAIL_NOTIFICATION, t0 + min))
    assertEquals(2, store.sourceCount(aiTxn))
    assertNull(ledger.onItem(a, alfalahPos(), Channel.EMAIL, t0 + 2 * min))
    assertNotNull(store.get(aiTxn))
    assertEquals(2, store.sourceCount(aiTxn))
  }

  @Test fun aReplacedAiTxnPassesItsCategoryAndOwnMarkToThePatternTxn() {
    val notification = nextItem++
    val aiTxn = ledger.onAi(notification, aiMoney(amount = 170_000, account = null, own = true, category = "Food"), Channel.EMAIL_NOTIFICATION, t0)!!
    assertTrue(store.get(aiTxn)!!.own)
    val id = ledger.onItem(notification, alfalahPos(), Channel.EMAIL, t0 + min)!!
    assertNull(store.get(aiTxn))
    assertEquals("Food", store.get(id)!!.category)
    assertTrue(store.get(id)!!.own)
    assertFalse(store.get(id)!!.ownSet)
  }

  @Test fun aiOnlyTxnIsNeverPairedByALaterPatternTxn() {
    val inn = ai(aiMoney(amount = 5_000_000, direction = Direction.IN, account = null, counterparty = "Someone", category = "Other"), Channel.NOTIFICATION, t0)!!
    val out = item(debit("50,000.00"), Channel.SMS, t0 + 10 * min)!!
    assertNull(store.get(inn)!!.pairId)
    assertNull(store.get(out)!!.pairId)
    assertFalse(store.get(inn)!!.own)
    assertFalse(store.get(out)!!.own)
  }

  @Test fun aPatternSourceMergingIntoAnAiTxnConfirmsIt() {
    item(debit("999.00"), Channel.SMS, t0 - 180 * min)   // makes "Alfalah 2310" a known account
    val aiTxn = ai(aiMoney(amount = 150_000, account = "Alfalah 2310"), Channel.NOTIFICATION, t0)!!
    assertTrue(store.get(aiTxn)!!.byAi)
    assertEquals(aiTxn, item(debit("1,500.00"), Channel.SMS, t0 + min))
    assertFalse(store.get(aiTxn)!!.byAi)
  }

  // --- Alfalah formats (stage 4b K1)
  private val qr = "PKR 2490 has been transferred to Test Shop from your BAFL A/C *2310 on 11-Nov-2026 at 12:30 via QR Tx ID FT26315ABCDEFGH1"
  private val raast = "PKR 2,490.00 paid to Test Shop from your BAFL A/C *2310 on 11-Nov-2026 12:32 via RAAST Tx FT26315ABCDEFGH1"
  private fun debited(amount: String = "5,000.00") =
    "Dear Customer,\nPKR $amount Debited from your A/C: 0847-1***2310 on 2-Nov-26 at 18:45:48 Bal: Reply with AB 021111225111"

  @Test fun qrAndRaastOfOnePaymentAreOneTxn() {
    val a = item(qr, Channel.SMS, t0)
    val b = item(raast, Channel.SMS, t0 + 2 * min)
    assertEquals(a, b)
    assertEquals(1, store.txns.size)
    // Two real payments of the same amount with different Tx IDs stay two.
    item(qr.replace("FT26315ABCDEFGH1", "FT26315ZZZZZZZZ2"), Channel.SMS, t0 + 3 * min)
    assertEquals(2, store.txns.size)
  }

  @Test fun sentToOwnNayaPayIsOwn() {
    owner = "Haroon Mukhtar"
    val id = item("PKR 1,000.00 sent to Haroon Mukhtar NayaPay from your BAF A/C *2310 on 3-Nov-26 10:15:22 via FT Tx ID FT26307AAAAAAAAA", Channel.SMS, t0)!!
    assertTrue(store.get(id)!!.own)
  }

  @Test fun receivedFromOwnUblBicIsOwn() {
    owner = "Haroon Mukhtar"
    val id = item("PKR 1000 received from Haroon Mukhtar UNILPKKARTG in your BAF A/C *2310 via your Raast ID on 08-11-26 at 12:00 Tx ID FT26312BBBBBBBBB", Channel.SMS, t0)!!
    assertTrue(store.get(id)!!.own)
  }

  @Test fun sameNameWithSurnameIsNotOwn() {
    owner = "Haroon Mukhtar"
    val id = item("PKR 1,000.00 sent to Haroon Mukhtar Khan from your BAF A/C *2310 on 3-Nov-26 10:15:22 via FT Tx ID FT26307CCCCCCCCC", Channel.SMS, t0)!!
    assertFalse(store.get(id)!!.own)
  }

  @Test fun fourDebitsSecondsApartStayFour() {
    repeat(4) { item(debited(), Channel.SMS, t0 + it * 20_000L) }
    assertEquals(4, store.txns.size)
  }

  @Test fun moneyOutSumsEveryFormat() {
    val texts = listOf(
      debited(), qr, raast,
      "PKR 1,500.00 sent to Some Person TMB from your BAF A/C **2310 on 3-Nov-26 10:15:22 with Fee PKR 5.00 via FT Tx ID FT26307ZZZZZZZZZ",
      "PKR 300 sent to Some Person PK***1234 from your BAF A/C *2310 on 5-Nov-26 09:10 Tx ID FT26309YYYYYYYYY",
      "PKR 3,897.00 Paid to NTEL Consumer ID 123456 from your BAF A/C **2310 on 4-Nov-26 11:11:11 via UBPS Tx ID FT26308XXXXXXXX1",
    )
    texts.forEachIndexed { i, text -> item(text, Channel.SMS, t0 + i * 60 * min) }
    assertEquals(500000L + 249000 + 150000 + 30000 + 389700, store.txns.values.filter { it.direction == Direction.OUT }.sumOf { it.amountMinor })
  }
}
