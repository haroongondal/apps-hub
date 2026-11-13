package expo.modules.inflowcore.core

class StoredItem(
  val id: Long, val capture: Capture, var search: String, val otpExpiresAt: Long?, var smsHash: String? = null, var deleted: Boolean = false,
  var emailHash: String? = null, var emailText: String? = null,
)

class MemoryItemStore : ItemStore, AiStore {
  val items = LinkedHashMap<String, StoredItem>()
  val tombstones = mutableSetOf<String>()
  private val settings = LinkedHashMap<String, AppSetting>()
  private val meta = HashMap<String, String>()
  private var nextId = 1L
  val queue = LinkedHashMap<Long, Pair<Long, Int>>()   // itemId -> (at, tries)
  val aiResults = LinkedHashMap<Long, AiResult>()
  val todos = mutableListOf<Pair<Long, AiTodo>>()
  val aiBlocks = mutableSetOf<String>()
  val spend = HashMap<String, Double>()

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
      .minWithOrNull(compareBy<StoredItem>({ Math.abs(it.capture.postedAt - at) }, { -it.id }))?.id

  override fun emailItemNear(text: String, at: Long, windowMs: Long) =
    items.values.any {
      val title = it.capture.title
      it.capture.pkg == Email.GMAIL && it.emailHash != null && it.emailText == null && Math.abs(it.capture.postedAt - at) <= windowMs &&
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
    old.forEach { forget(items.remove(it)) }
    return old.size
  }

  override fun deleteApp(pkg: String): Int {
    val mine = items.filterValues { it.capture.pkg == pkg }.keys.toList()
    mine.forEach { forget(items.remove(it)) }
    return mine.size
  }

  // Retention and deleteApp take the item's tombstone, queue entry, result and to-dos with it.
  private fun forget(item: StoredItem?) {
    item ?: return
    item.emailHash?.let(tombstones::add)
    queue.remove(item.id)
    aiResults.remove(item.id)
    todos.removeAll { it.first == item.id }
  }

  override fun allAppSettings(): List<AppSetting> = settings.values.toList()

  override fun meta(key: String): String? = meta[key]

  override fun setMeta(key: String, value: String) {
    meta[key] = value
  }

  override fun enqueueAi(itemId: Long, at: Long) {
    if (itemId !in queue) queue[itemId] = at to 0
  }

  override fun enabledSince(): Long? = meta[AiMeta.SINCE]?.toLongOrNull()

  // Mirrors SqlItemStore.queued: the same conditions, evaluated now.
  override fun queued(limit: Int): List<AiInput> {
    val since = enabledSince() ?: return emptyList()
    return queue.entries.sortedWith(compareBy({ it.value.first }, { it.key })).mapNotNull { (id, _) ->
      val it = items.values.firstOrNull { s -> s.id == id } ?: return@mapNotNull null
      val c = it.capture
      val ok = it.otpExpiresAt == null && c.postedAt >= since && (settings[c.pkg]?.record ?: true) &&
        "app:${c.pkg}" !in aiBlocks && (c.senderKey == null || "sender:${c.senderKey}" !in aiBlocks)
      if (ok) AiInput(id, c.appLabel, c.sender, c.title, it.emailText ?: c.text, c.postedAt) else null
    }.take(limit)
  }

  override fun save(results: List<AiResult>, now: Long) {
    for (r in results) {
      if (items.values.none { it.id == r.itemId }) continue
      aiResults[r.itemId] = r
      todos.removeAll { it.first == r.itemId }
      r.todos.forEach { todos += r.itemId to it }
    }
    results.forEach { queue.remove(it.itemId) }
  }

  override fun failed(itemIds: List<Long>) {
    for (id in itemIds) {
      val (at, tries) = queue[id] ?: continue
      if (tries + 1 >= 2) queue.remove(id) else queue[id] = at to tries + 1
    }
  }

  override fun spentToday(day: String) = spend[day] ?: 0.0

  override fun addSpend(day: String, usd: Double) {
    spend[day] = spentToday(day) + usd
  }
}
