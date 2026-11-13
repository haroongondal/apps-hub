package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SmsIngestTest {
  private val pkg = "com.google.android.apps.messaging"
  private val min = 60_000L
  private var clock = 1_700_000_000_000L
  private val store = MemoryItemStore()
  private val ledgerStore = MemoryLedgerStore()
  private val ingest = Ingest(store, "com.haroon.inflow", { clock }, ledger = Ledger(ledgerStore, { null }))

  private val debit =
    "Dear Customer,\nYour Debit Card against A/C: 0847-1***2310 is charged for PKR 1,500.00 on 12-Nov-26 at 16:23:38 at SHAAFI INTERNATIONAL HOSPIslamabad PK."
  private val otp = "OTP 123456 for PKR 25,000 at Daraz"

  private fun sms(body: String, sentAt: Long = clock, receivedAt: Long = clock) = RawSms("Alfalah", body, sentAt, receivedAt)

  private fun notification(text: String, at: Long = clock) = RawNotification(
    pkg = pkg, appLabel = "Messages", key = "0|$pkg|1|null|10001", postTime = at,
    ongoing = false, groupSummary = false,
    title = "Alfalah", text = text, bigText = null, subText = null,
    conversationTitle = null, isGroupConversation = false,
    messages = emptyList(), textLines = emptyList(),
  )

  @Test fun smsThenNotificationIsOneItem() {
    assertEquals(1, ingest.onSms(sms(debit), pkg, "Messages"))
    assertEquals(0, ingest.onNotification(notification(debit, clock + min)))
    assertEquals(1, store.items.size)
    assertEquals(1, ledgerStore.txns.size)
  }

  @Test fun notificationThenSmsIsOneItem() {
    assertEquals(1, ingest.onNotification(notification(debit)))
    val raw = sms(debit, receivedAt = clock + min)
    assertEquals(0, ingest.onSms(raw, pkg, "Messages"))
    assertEquals(0, ingest.onSms(raw, pkg, "Messages"))
    assertEquals(1, store.items.size)
    assertNotNull(store.items.values.single().smsHash)
    assertEquals(1, ledgerStore.txns.size)
  }

  @Test fun receiverAndInboxSameSmsOnce() {
    assertEquals(1, ingest.onSms(sms(debit), pkg, "Messages"))
    assertEquals(0, ingest.onSms(sms(debit), pkg, "Messages"))
    assertEquals(1, store.items.size)
    assertEquals(1, ledgerStore.txns.size)
  }

  @Test fun twoIdenticalChargesStayTwo() {
    assertEquals(1, ingest.onSms(sms(debit, sentAt = clock), pkg, "Messages"))
    assertEquals(1, ingest.onSms(sms(debit, sentAt = clock + min, receivedAt = clock + min), pkg, "Messages"))
    assertEquals(2, store.items.size)
    assertEquals(2, ledgerStore.txns.size)
  }

  @Test fun twoIdenticalChargesWithTheirNotificationsStayTwo() {
    ingest.onNotification(notification(debit, clock))
    ingest.onNotification(notification(debit, clock + min).copy(key = "0|$pkg|2|null|10001"))
    ingest.onSms(sms(debit, sentAt = clock), pkg, "Messages")
    ingest.onSms(sms(debit, sentAt = clock + min, receivedAt = clock + min), pkg, "Messages")
    assertEquals(2, store.items.size)
    assertEquals(2, ledgerStore.txns.size)
  }

  @Test fun expiredOtpNotImported() {
    assertEquals(0, ingest.onSms(sms(otp, receivedAt = clock - 6 * min), pkg, "Messages"))
    assertTrue(store.items.isEmpty())
  }

  @Test fun otpLivesOnlyWhatIsLeftOfItsFiveMinutes() {
    assertEquals(1, ingest.onSms(sms(otp, receivedAt = clock - 4 * min), pkg, "Messages"))
    assertEquals(clock + min, store.items.values.single().otpExpiresAt)
  }

  @Test fun purgedOtpNotReimported() {
    assertEquals(1, ingest.onSms(sms(otp), pkg, "Messages"))
    clock += Ingest.OTP_TTL_MS + 1
    ingest.housekeeping()
    assertTrue(store.items.isEmpty())
    assertEquals(0, ingest.onSms(sms(otp, sentAt = clock - 1000, receivedAt = clock), pkg, "Messages"))
    assertEquals(0, ingest.onNotification(notification(otp, clock)))
    assertTrue(store.items.isEmpty())
  }

  @Test fun recordOffSkipsSms() {
    store.putAppSetting(AppSetting(pkg, "Messages", false, null))
    assertEquals(0, ingest.onSms(sms(debit), pkg, "Messages"))
    assertTrue(store.items.isEmpty())
  }

  @Test fun bankSmsMakesOneTxn() {
    ingest.onSms(sms(debit), pkg, "Messages")
    ingest.onNotification(notification(debit, clock + 2 * min))
    assertEquals(1, store.items.size)
    val txn = ledgerStore.txns.values.single()
    assertEquals(150000L, txn.amountMinor)
    assertEquals(setOf(Channel.SMS), txn.channels)
  }

  @Test fun notificationAndSmsAsSeparateSourcesMergeInLedger() {
    // Different texts (the notification truncates), so no item twin: the ledger does the merge.
    ingest.onNotification(notification(debit.substringAfter("Your ")))
    ingest.onSms(sms(debit), pkg, "Messages")
    assertEquals(2, store.items.size)
    assertEquals(setOf(Channel.SMS, Channel.SMS_NOTIFICATION), ledgerStore.txns.values.single().channels)
  }

  @Test fun otpNeverTransaction() {
    assertEquals(1, ingest.onSms(sms(otp), pkg, "Messages"))
    assertEquals(0, ingest.onNotification(notification(otp, clock + min)))
    assertTrue(ledgerStore.txns.isEmpty())
  }

  @Test fun bankPatternIsNeverOtp() {
    val text = "PKR  5,000.00 Credited to your A/C: 0847-1***2310 on 13-Nov-26 at 12:02:54. Never share your PIN or OTP with anyone."
    assertEquals(1, ingest.onSms(sms(text), pkg, "Messages"))
    assertEquals(1, ingest.onNotification(notification(text.replace("5,000", "6,000"), clock + 20 * min)))
    assertEquals(2, store.items.size)
    assertTrue(store.items.values.all { it.otpExpiresAt == null })
    assertEquals(2, ledgerStore.txns.size)
  }

  @Test fun claimedNotificationTwinCountsAsSmsChannel() {
    ingest.onNotification(notification(debit, clock))
    assertEquals(0, ingest.onSms(sms(debit, sentAt = clock), pkg, "Messages"))
    assertEquals(1, ingest.onSms(sms(debit, sentAt = clock + min, receivedAt = clock + min), pkg, "Messages"))
    assertEquals(setOf(Channel.SMS_NOTIFICATION, Channel.SMS), ledgerStore.txns.values.first().channels)
    assertEquals(2, ledgerStore.txns.size)
  }
}
