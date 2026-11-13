package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EmailIngestTest {
  private val min = 60_000L
  private val t0 = 1_700_000_000_000L
  private val gm = "com.google.android.gm"
  private val store = MemoryItemStore()
  private val ledgerStore = MemoryLedgerStore()
  private val ingest = Ingest(store, "com.haroon.inflow", { t0 }, ledger = Ledger(ledgerStore, { null }))

  private val subject = "Transaction Successful"
  private val posEmail = Samples.ALFALAH_EMAIL
  private val debitSms =
    "Dear Customer,\nYour Debit Card against A/C: 0847-1***2310 is charged for PKR 1,700.00 on 12-Nov-26 at 16:23:38 at SHAAFI INTERNATIONAL HOSPIslamabad PK."

  private fun notification(subject: String = this.subject, snippet: String = "Your transaction was successful.", at: Long = t0) = RawNotification(
    pkg = gm, appLabel = "Gmail", key = "0|$gm|1|null|10001", postTime = at,
    ongoing = false, groupSummary = false,
    title = "Bank Alfalah", text = snippet, bigText = "$subject\n$snippet", subText = null,
    conversationTitle = null, isGroupConversation = false,
    messages = emptyList(), textLines = emptyList(),
  )

  private fun email(subject: String = this.subject, text: String = posEmail, at: Long = t0 + min, id: String = "<m1>") =
    RawEmail(id, "Bank Alfalah", "email.notification@bankalfalah.com", subject, text, at)

  @Test fun notificationThenEmailIsOneItem() {
    assertEquals(1, ingest.onNotification(notification()))
    val original = store.items.values.single().capture.text
    assertEquals(1, ingest.onEmail(email(), "Gmail"))
    assertEquals(1, store.items.size)
    val item = store.items.values.single()
    assertEquals(posEmail, item.emailText)
    assertEquals(original, item.capture.text)
    assertNotNull(item.emailHash)
    assertEquals(0, ingest.onEmail(email(), "Gmail"))
    assertEquals(1, store.items.size)
  }

  @Test fun emailThenNotificationIsOneItem() {
    assertEquals(1, ingest.onEmail(email(at = t0), "Gmail"))
    assertEquals(0, ingest.onNotification(notification(at = t0 + min)))
    assertEquals(1, store.items.size)
    assertEquals(posEmail, store.items.values.single().capture.text)
  }

  @Test fun differentSubjectStaysTwo() {
    ingest.onNotification(notification(subject = "Something else"))
    assertEquals(1, ingest.onEmail(email(), "Gmail"))
    assertEquals(2, store.items.size)
  }

  @Test fun outsideWindowStaysTwo() {
    ingest.onNotification(notification())
    assertEquals(1, ingest.onEmail(email(at = t0 + 11 * min), "Gmail"))
    assertEquals(2, store.items.size)
  }

  @Test fun otpEmailNeverSaved() {
    assertEquals(0, ingest.onEmail(email(subject = "Your code", text = "Your OTP is 482913. Do not share it."), "Gmail"))
    assertTrue(store.items.isEmpty())
  }

  @Test fun recordOffSkipsEmail() {
    store.putAppSetting(AppSetting(gm, "Gmail", false, 90))
    assertEquals(0, ingest.onEmail(email(), "Gmail"))
    assertTrue(store.items.isEmpty())
  }

  @Test fun smsNotificationAndEmailOneTxn() {
    assertEquals(1, ingest.onSms(RawSms("Alfalah", debitSms, t0, t0), "com.google.android.apps.messaging", "Messages"))
    assertEquals(1, ingest.onNotification(notification(at = t0 + min)))
    assertEquals(1, ingest.onEmail(email(at = t0 + 3 * min), "Gmail"))
    assertEquals(2, store.items.size)
    assertNotNull(store.items.values.single { it.capture.pkg == gm }.emailText)
    val txn = ledgerStore.txns.values.single()
    assertEquals(setOf(Channel.SMS, Channel.EMAIL), txn.channels)
    assertEquals("FT263160G6MC4S12", txn.txId)
  }

  @Test fun claimedTwinWithTxnGainsEmailChannel() {
    ingest.onNotification(notification(subject = "Card alert", snippet = debitSms))
    assertEquals(setOf(Channel.EMAIL_NOTIFICATION), ledgerStore.txns.values.single().channels)
    assertEquals(1, ingest.onEmail(email(subject = "Card alert"), "Gmail"))
    assertEquals(1, store.items.size)
    assertEquals(setOf(Channel.EMAIL_NOTIFICATION, Channel.EMAIL), ledgerStore.txns.values.single().channels)
  }

  @Test fun emailItemOwnsItsTransactionAndSearch() {
    assertEquals(1, ingest.onEmail(email(), "Gmail"))
    val item = store.items.values.single()
    assertNull(item.emailText)
    assertNotNull(item.emailHash)
    assertEquals(Channel.EMAIL, ledgerStore.txns.values.single().channels.single())
  }

  @Test fun nonPosAlfalahEmailIsSavedNotLostAsOtp() {
    val ibft = posEmail.replace("POS", "IBFT")
    assertEquals(1, ingest.onEmail(email(text = ibft), "Gmail"))
    assertEquals(1, store.items.size)
    assertTrue(ledgerStore.txns.isEmpty())
  }

  @Test fun otpSubjectAndBodyStillDropped() {
    assertEquals(0, ingest.onEmail(email(subject = "Your one-time password", text = "Your OTP is 482913"), "Gmail"))
    assertTrue(store.items.isEmpty())
  }

  @Test fun theNearestNotificationIsClaimed() {
    ingest.onNotification(notification(at = t0))
    ingest.onNotification(notification(at = t0 + 3 * min).copy(key = "0|$gm|2|null|10002"))
    assertEquals(2, store.items.size)
    assertEquals(1, ingest.onEmail(email(at = t0 + 30_000), "Gmail"))
    val byTime = store.items.values.sortedBy { it.capture.postedAt }
    assertNotNull(byTime[0].emailText)
    assertNull(byTime[1].emailText)
  }

  @Test fun aClaimedNotificationDoesNotHideAnotherSendersGmailNotification() {
    ingest.onNotification(notification())
    ingest.onEmail(email(), "Gmail")
    val other = notification(subject = "Bank Alfalah update", at = t0 + min).copy(title = "Other Bank")
    assertEquals(1, ingest.onNotification(other))
    assertEquals(2, store.items.size)
  }

  @Test fun deletedEmailsDoNotReturnWhenReadAgain() {
    assertEquals(1, ingest.onEmail(email(), "Gmail"))
    store.deleteApp(gm)
    assertTrue(store.items.isEmpty())
    assertEquals(0, ingest.onEmail(email(), "Gmail"))
    assertTrue(store.items.isEmpty())
  }

  @Test fun emailsPurgedByRetentionDoNotReturnEither() {
    assertEquals(1, ingest.onEmail(email(), "Gmail"))
    store.purgeOlder(gm, t0 + 10 * min)
    assertTrue(store.items.isEmpty())
    assertEquals(0, ingest.onEmail(email(), "Gmail"))
  }
}
