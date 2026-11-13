package expo.modules.inflowcore.core

class StoredItem(
  val id: Long, val capture: Capture, var search: String, val otpExpiresAt: Long?, var smsHash: String? = null, var deleted: Boolean = false,
  var emailHash: String? = null, var emailText: String? = null,
)

class MemoryItemStore : ItemStore {
  val items = LinkedHashMap<String, StoredItem>()
  val tombstones = mutableSetOf<String>()
  private val settings = LinkedHashMap<String, AppSetting>()
  private val meta = HashMap<String, String>()
  private var nextId = 1L

  override fun appSetting(pkg: String): AppSetting? = settings[pkg]

  override fun putAppSetting(s: AppSetting) {
    settings[s.pkg] = s
  }

  override fun insert(c: Capture, search: String, otpExpiresAt: Long?, smsHash: String?, emailHash: String?): Long? {
    if (c.hash in items || c.hash in tombstones) return null
    if (smsHash != null && hasSmsHash(smsHash)) return null
    if (emailHash != null && hasEmailHash(emailHash)) return null
    val id = nextId++
    items[c.hash] = StoredItem(id, c, search, otpExpiresAt, smsHash, emailHash = emailHash)
    return id
  }

  override fun isTombstoned(hash: String) = hash in tombstones

  override fun hasSmsHash(smsHash: String) = items.values.any { it.smsHash == smsHash }

  override fun smsItemNear(text: String, at: Long, windowMs: Long) =
    items.values.any { it.smsHash != null && it.capture.text == text && Math.abs(it.capture.postedAt - at) <= windowMs }

  override fun notificationTwin(text: String, at: Long, windowMs: Long, pkgs: Set<String>): Long? =
    items.values
      .filter { it.smsHash == null && it.capture.pkg in pkgs && it.capture.text == text && Math.abs(it.capture.postedAt - at) <= windowMs }
      .maxWithOrNull(compareBy<StoredItem>({ it.capture.postedAt }, { it.id }))?.id

  override fun hasEmailHash(emailHash: String) = items.values.any { it.emailHash == emailHash }

  override fun emailTwin(subject: String, at: Long, windowMs: Long): Long? =
    if (subject.isBlank()) null
    else items.values
      .filter {
        it.capture.pkg == Email.GMAIL && it.emailHash == null && Math.abs(it.capture.postedAt - at) <= windowMs && it.capture.text.startsWith(subject)
      }
      .maxWithOrNull(compareBy<StoredItem>({ it.capture.postedAt }, { it.id }))?.id

  override fun emailItemNear(text: String, at: Long, windowMs: Long) =
    items.values.any {
      val title = it.capture.title
      it.capture.pkg == Email.GMAIL && it.emailHash != null && Math.abs(it.capture.postedAt - at) <= windowMs &&
        !title.isNullOrBlank() && text.startsWith(title)
    }

  override fun claimEmail(itemId: Long, emailHash: String, emailText: String, search: String) {
    val it = items.values.first { it.id == itemId }
    it.emailHash = emailHash
    it.emailText = emailText
    it.search = it.search + " " + search
  }

  override fun setSmsHash(itemId: Long, smsHash: String) {
    items.values.first { it.id == itemId }.smsHash = smsHash
  }

  override fun markDeletedBySender(pkg: String, conversationKey: String?, sender: String?, postedAt: Long): Boolean {
    val hit = items.values.firstOrNull {
      val c = it.capture
      c.pkg == pkg && c.conversationKey == conversationKey && c.sender == sender && c.postedAt == postedAt
    } ?: return false
    hit.deleted = true
    return true
  }

  override fun purgeExpiredOtps(now: Long): Int {
    val expired = items.filterValues { (it.otpExpiresAt ?: Long.MAX_VALUE) <= now }.keys.toList()
    expired.forEach { tombstones.add(it); tombstones.add(Sms.textHash(items.getValue(it).capture.text)); items.remove(it) }
    return expired.size
  }

  override fun purgeOlder(pkg: String, cutoff: Long): Int {
    val old = items.filterValues { it.capture.pkg == pkg && it.capture.postedAt < cutoff }.keys.toList()
    old.forEach { items.remove(it) }
    return old.size
  }

  override fun deleteApp(pkg: String): Int {
    val mine = items.filterValues { it.capture.pkg == pkg }.keys.toList()
    mine.forEach { items.remove(it) }
    return mine.size
  }

  override fun allAppSettings(): List<AppSetting> = settings.values.toList()

  override fun meta(key: String): String? = meta[key]

  override fun setMeta(key: String, value: String) {
    meta[key] = value
  }
}
