package expo.modules.inflowcore.core

class Ingest(
  private val store: ItemStore,
  private val ownPkg: String,
  private val now: () -> Long,
  private val onOtpSaved: (expiresAt: Long) -> Unit = {},
  private val ledger: Ledger? = null,
  private val smsPackages: Set<String> = Sms.KNOWN_APPS,
  private val aiOn: () -> Boolean = { false },
) {
  fun onNotification(raw: RawNotification): Int {
    if (raw.pkg == ownPkg) return 0
    val setting = store.appSetting(raw.pkg)
      ?: Retention.default(raw.pkg, raw.appLabel).also { store.putAppSetting(it) }
    if (!setting.record) return 0

    var saved = 0
    for (c in NotificationParser.parse(raw, ownPkg, store)) {
      if (c.deletedPlaceholder) {
        store.markDeletedBySender(c.pkg, c.conversationKey, c.sender, c.postedAt)
        continue
      }
      val fromSmsApp = c.pkg in smsPackages
      // The SMS path owns this message; a purged OTP's text stays tombstoned against a re-posted notification.
      if (fromSmsApp && (store.smsItemNear(c.text, c.postedAt, Dedup.MERGE_WINDOW_MS) || store.isTombstoned(Sms.textHash(c.text)))) continue
      // The saved email owns this message: its notification would only be a thinner copy.
      if (c.pkg == Email.GMAIL && store.emailItemNear(c.text, c.postedAt, Dedup.MERGE_WINDOW_MS)) continue
      val search = searchOf(c)
      val otpExpiresAt = if (isOtp(c.pkg, c.text)) now() + OTP_TTL_MS else null
      val id = store.insert(c, search, otpExpiresAt) ?: continue
      saved++
      otpExpiresAt?.let(onOtpSaved)
      if (otpExpiresAt == null) {
        val channel = when {
          fromSmsApp -> Channel.SMS_NOTIFICATION
          c.pkg == Email.GMAIL -> Channel.EMAIL_NOTIFICATION
          else -> Channel.NOTIFICATION
        }
        ledger?.onItem(id, c.text, channel, c.postedAt)
        queueForAi(id)
      }
    }
    housekeeping()
    return saved
  }

  fun onSms(sms: RawSms, smsPkg: String, smsLabel: String): Int {
    val setting = store.appSetting(smsPkg) ?: Retention.default(smsPkg, smsLabel).also { store.putAppSetting(it) }
    if (!setting.record) return 0
    val c = Sms.capture(sms, smsPkg, smsLabel)
    if (store.hasSmsHash(c.hash) || store.isTombstoned(c.hash) || store.isTombstoned(Sms.textHash(sms.body))) return 0
    val isOtp = isOtp(smsPkg, sms.body)
    if (isOtp && c.postedAt + OTP_TTL_MS <= now()) return 0
    val twin = store.notificationTwin(sms.body, c.postedAt, Dedup.MERGE_WINDOW_MS, smsPackages)
    if (twin != null) {
      store.setSmsHash(twin, c.hash)
      ledger?.addChannel(twin, Channel.SMS)
      return 0
    }
    // An OTP from the inbox lives only what is left of its 5 minutes.
    val otpExpiresAt = if (isOtp) minOf(c.postedAt, now()) + OTP_TTL_MS else null
    val id = store.insert(c, searchOf(c), otpExpiresAt, c.hash) ?: return 0
    otpExpiresAt?.let(onOtpSaved)
    if (!isOtp) {
      ledger?.onItem(id, sms.body, Channel.SMS, c.postedAt)
      queueForAi(id)
    }
    housekeeping()
    return 1
  }

  /** 1 when a new item was saved or a notification item gained its email, else 0. */
  fun onEmail(e: RawEmail, label: String): Int {
    val setting = store.appSetting(Email.GMAIL) ?: Retention.default(Email.GMAIL, label).also { store.putAppSetting(it) }
    if (!setting.record) return 0
    val h = Email.hash(e)
    if (store.hasEmailHash(h) || store.isTombstoned(h)) return 0
    // The Alfalah template carries "WhatsApp QR Code" and 4-digit tokens, so the body alone is not enough: the subject must ask for a code too.
    if (OtpDetector.hasKeyword(e.subject) && isOtp(Email.GMAIL, e.text)) return 0
    val twin = store.emailTwin(e.subject, e.at, Dedup.MERGE_WINDOW_MS)
    if (twin != null) {
      store.claimEmail(twin, h, e.text, SearchText.normalize(e.text))
      ledger?.onItem(twin, e.text, Channel.EMAIL, e.at) ?: ledger?.addChannel(twin, Channel.EMAIL)
      return 1
    }
    val c = Email.capture(e, label)
    val id = store.insert(c, searchOf(c), null, emailHash = h) ?: return 0
    ledger?.onItem(id, e.text, Channel.EMAIL, e.at)
    queueForAi(id)
    housekeeping()
    return 1
  }

  // OTPs never get here. Whether the item may really be sent is decided again at send time (AiStore.queued).
  private fun queueForAi(id: Long) {
    if (aiOn()) store.enqueueAi(id, now())
  }

  // A bank-pattern message is money news, never an OTP, whatever warning text it carries.
  private fun isOtp(pkg: String, text: String) = OtpDetector.isOtp(pkg, text) && BankParser.parse(text) == null

  private fun searchOf(c: Capture) = SearchText.normalize(listOfNotNull(c.sender, c.conversation, c.title, c.text).joinToString(" "))

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
