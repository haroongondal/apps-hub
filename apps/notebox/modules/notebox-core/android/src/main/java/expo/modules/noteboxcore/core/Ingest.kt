package expo.modules.noteboxcore.core

class Ingest(
  private val store: ItemStore,
  private val ownPkg: String,
  private val now: () -> Long,
  private val onOtpSaved: (expiresAt: Long) -> Unit = {},
) {
  fun onNotification(raw: RawNotification): Int {
    if (raw.pkg == ownPkg) return 0
    val setting = store.appSetting(raw.pkg)
      ?: Retention.default(raw.pkg, raw.appLabel).also { store.putAppSetting(it) }
    if (!setting.record) return 0

    var saved = 0
    for (c in NotificationParser.parse(raw, ownPkg)) {
      if (c.deletedPlaceholder) {
        store.markDeletedBySender(c.pkg, c.conversationKey, c.sender, c.postedAt)
        continue
      }
      val search = SearchText.normalize(listOfNotNull(c.sender, c.conversation, c.title, c.text).joinToString(" "))
      val otpExpiresAt = if (OtpDetector.isOtp(c.pkg, c.text)) now() + OTP_TTL_MS else null
      if (store.insert(c, search, otpExpiresAt)) {
        saved++
        otpExpiresAt?.let(onOtpSaved)
      }
    }
    housekeeping()
    return saved
  }

  fun housekeeping() {
    val t = now()
    store.purgeExpiredOtps(t)
    val last = store.meta(LAST_RETENTION)?.toLongOrNull()
    if (last != null && t - last < DAY_MS) return
    for (app in store.allAppSettings()) {
      val days = app.keepDays ?: continue
      store.purgeOlder(app.pkg, t - days * DAY_MS)
    }
    store.setMeta(LAST_RETENTION, t.toString())
  }

  companion object {
    const val OTP_TTL_MS = 5 * 60_000L
    const val DAY_MS = 86_400_000L
    private const val LAST_RETENTION = "lastRetentionAt"
  }
}
