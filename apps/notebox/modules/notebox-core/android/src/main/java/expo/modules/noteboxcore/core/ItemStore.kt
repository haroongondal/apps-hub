package expo.modules.noteboxcore.core

data class AppSetting(val pkg: String, val label: String, val record: Boolean, val keepDays: Int?)   // keepDays null = forever

interface ItemStore {
  fun appSetting(pkg: String): AppSetting?
  fun putAppSetting(s: AppSetting)

  /** False when the hash is already saved or tombstoned. */
  fun insert(c: Capture, search: String, otpExpiresAt: Long?): Boolean

  fun markDeletedBySender(pkg: String, conversationKey: String?, sender: String?, postedAt: Long): Boolean
  fun purgeExpiredOtps(now: Long): Int
  fun purgeOlder(pkg: String, cutoff: Long): Int
  fun deleteApp(pkg: String): Int
  fun allAppSettings(): List<AppSetting>
  fun meta(key: String): String?
  fun setMeta(key: String, value: String)
}
