package expo.modules.inflowcore.core

import java.security.MessageDigest

data class RawSms(val address: String, val body: String, val sentAt: Long, val receivedAt: Long)  // sentAt = provider date_sent = PDU timestamp

object Sms {
  val KNOWN_APPS: Set<String> = setOf(
    "com.google.android.apps.messaging",
    "com.android.mms",
    "com.samsung.android.messaging",
  )

  fun hash(senderKey: String, sentAt: Long, body: String): String = sha256Hex("sms\u0000$senderKey\u0000$sentAt\u0000$body")

  /** Tombstone for a purged OTP, so a later inbox sync cannot bring it back under another timestamp. */
  fun textHash(text: String): String = sha256Hex("text\u0000${text.trim()}")

  fun capture(sms: RawSms, smsPkg: String, smsLabel: String): Capture {
    val key = senderKey(smsPkg, sms.address)
    return Capture(
      pkg = smsPkg, appLabel = smsLabel,
      sender = sms.address, senderKey = key,
      conversation = sms.address, conversationKey = key,
      title = null, text = sms.body,
      postedAt = if (sms.receivedAt != 0L) sms.receivedAt else sms.sentAt,
      hash = hash(key, sms.sentAt, sms.body),
      deletedPlaceholder = false,
    )
  }

  private fun sha256Hex(s: String): String =
    MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}
