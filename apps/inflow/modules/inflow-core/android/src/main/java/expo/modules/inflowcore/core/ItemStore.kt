package expo.modules.inflowcore.core

data class AppSetting(val pkg: String, val label: String, val record: Boolean, val keepDays: Int?)   // keepDays null = forever

interface ItemStore {
  fun appSetting(pkg: String): AppSetting?
  fun putAppSetting(s: AppSetting)

  /** The new row id; null when the hash, SMS hash or email hash is already saved or tombstoned. */
  fun insert(c: Capture, search: String, otpExpiresAt: Long?, smsHash: String? = null, emailHash: String? = null): Long?
  fun isTombstoned(hash: String): Boolean
  fun hasSmsHash(smsHash: String): Boolean
  /** An item from the SMS channel (sms_hash set) with exactly this text, posted within ±window. Expired but unpurged OTP rows count: they are about to be tombstoned. */
  fun smsItemNear(text: String, at: Long, windowMs: Long): Boolean
  /** Newest notification item (sms_hash null) from one of pkgs with exactly this text within ±window. */
  fun notificationTwin(text: String, at: Long, windowMs: Long, pkgs: Set<String>): Long?
  fun hasEmailHash(emailHash: String): Boolean
  /** Newest Gmail item with email_hash null, posted within ±window, whose text starts with subject (subject non-blank). */
  fun emailTwin(subject: String, at: Long, windowMs: Long): Long?
  /** A Gmail item with email_hash set, posted within ±window, whose non-blank title the given notification text starts with. */
  fun emailItemNear(text: String, at: Long, windowMs: Long): Boolean
  /** Sets email_hash and email_text on a notification item and adds the email text to its search column. */
  fun claimEmail(itemId: Long, emailHash: String, emailText: String, search: String)
  fun setSmsHash(itemId: Long, smsHash: String)

  fun markDeletedBySender(pkg: String, conversationKey: String?, sender: String?, postedAt: Long): Boolean
  /** Also tombstones Sms.textHash(text) of each purged row. */
  fun purgeExpiredOtps(now: Long): Int
  fun purgeOlder(pkg: String, cutoff: Long): Int
  fun deleteApp(pkg: String): Int
  fun allAppSettings(): List<AppSetting>
  fun meta(key: String): String?
  fun setMeta(key: String, value: String)
}
