package expo.modules.noteboxcore.core

class StoredItem(val capture: Capture, val search: String, val otpExpiresAt: Long?, var deleted: Boolean = false)

class MemoryItemStore : ItemStore {
  val items = LinkedHashMap<String, StoredItem>()
  val tombstones = mutableSetOf<String>()
  private val settings = LinkedHashMap<String, AppSetting>()
  private val meta = HashMap<String, String>()

  override fun appSetting(pkg: String): AppSetting? = settings[pkg]

  override fun putAppSetting(s: AppSetting) {
    settings[s.pkg] = s
  }

  override fun insert(c: Capture, search: String, otpExpiresAt: Long?): Boolean {
    if (c.hash in items || c.hash in tombstones) return false
    items[c.hash] = StoredItem(c, search, otpExpiresAt)
    return true
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
    expired.forEach { items.remove(it); tombstones.add(it) }
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
