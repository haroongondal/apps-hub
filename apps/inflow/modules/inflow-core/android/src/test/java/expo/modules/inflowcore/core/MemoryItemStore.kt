package expo.modules.inflowcore.core

class StoredItem(
  val id: Long, val capture: Capture, var search: String, val otpExpiresAt: Long?, var smsHash: String? = null, var deleted: Boolean = false,
  var emailHash: String? = null, var emailText: String? = null,
)

class MemoryItemStore : ItemStore, AiStore, BackfillStore, AutopilotItems {
  val items = LinkedHashMap<String, StoredItem>()
  val tombstones = mutableSetOf<String>()
  private val settings = LinkedHashMap<String, AppSetting>()
  private val meta = HashMap<String, String>()
  private var nextId = 1L
  val queue = LinkedHashMap<Long, Pair<Long, Int>>()   // itemId -> (at, tries)
  val fastIds = mutableSetOf<Long>()   // the queue rows marked fast
  val aiResults = LinkedHashMap<Long, AiResult>()
  val todos = mutableListOf<Pair<Long, AiTodo>>()
  val aiBlocks = mutableSetOf<String>()
  val spend = HashMap<String, Double>()

  val chats = HashMap<String, String>()   // chat_map: tag -> name

  override fun nameFor(tag: String): String? = chats[tag]

  override fun learn(tag: String, name: String) {
    chats[tag] = name
  }

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

  override fun hasOwnMessageAfter(pkg: String, conversationKey: String, at: Long): Boolean =
    items.values.any { it.capture.pkg == pkg && it.capture.conversationKey == conversationKey && it.capture.sender.equals("You", ignoreCase = true) && it.capture.postedAt > at }

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

  // Mirrors SqlItemStore.removeByOwner: the item's hash, SMS hash and email hash are tombstoned (not its text hash).
  override fun deleteItem(id: Long): Boolean {
    val hash = items.entries.firstOrNull { it.value.id == id }?.key ?: return false
    removeByOwner(hash)
    return true
  }

  override fun deleteConversation(key: String): Int {
    val hashes = items.filterValues { it.capture.conversationKey == key }.keys.toList()
    hashes.forEach(::removeByOwner)
    return hashes.size
  }

  private fun removeByOwner(hash: String) {
    val item = items.remove(hash) ?: return
    tombstones.add(hash)
    item.smsHash?.let(tombstones::add)
    forget(item)
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

  override fun enqueueAi(itemId: Long, at: Long, fast: Boolean) {
    if (itemId in queue) return   // INSERT OR IGNORE: a queued row keeps its fast mark
    queue[itemId] = at to 0
    if (fast) fastIds += itemId
  }

  override fun enabledSince(): Long? = meta[AiMeta.SINCE]?.toLongOrNull()

  // Mirrors SqlItemStore.queued: the same conditions, evaluated now.
  override fun queued(limit: Int, fastOnly: Boolean): List<AiInput> {
    val since = enabledSince() ?: return emptyList()
    val picked = AutopilotSettings.fromJson(meta[AUTOPILOT_META]).pickedChats
    val sendable = queue.entries.sortedWith(compareBy({ it.value.first }, { it.key })).mapNotNull { (id, _) ->
      val it = items.values.firstOrNull { s -> s.id == id }
      val c = it?.capture
      val ok = it != null && c != null && it.otpExpiresAt == null && (it.smsHash != null || it.emailHash != null || c.pkg in AiChannels.PKGS || (c.conversationKey != null && pickedChatKey(c.pkg, c.conversationKey) in picked)) && c.postedAt >= since && (settings[c.pkg]?.record ?: true) &&
        "app:${c.pkg}" !in aiBlocks && (c.senderKey == null || "sender:${c.senderKey}" !in aiBlocks)
      if (ok) AiInput(id, c!!.appLabel, c.sender, c.title, it!!.emailText ?: c.text, c.postedAt, c.conversation, c.sender.equals("You", ignoreCase = true), c.conversationKey, c.pkg, it.smsHash == null && it.emailHash == null && c.pkg !in AiChannels.PKGS) else null
    }
    queue.keys.retainAll(sendable.map { it.itemId }.toSet())
    return sendable.filter { !fastOnly || it.itemId in fastIds }.take(limit)
  }

  // Mirrors SqlItemStore.autopilotItem: the queue's conditions without the posted_at one, minus NEVER_SHARE.
  override fun autopilotItem(id: Long): AutopilotItem? {
    val it = items.values.firstOrNull { s -> s.id == id } ?: return null
    val c = it.capture
    val picked = AutopilotSettings.fromJson(meta[AUTOPILOT_META]).pickedChats
    val ok = it.otpExpiresAt == null && (it.smsHash != null || it.emailHash != null || c.pkg in AiChannels.PKGS || (c.conversationKey != null && pickedChatKey(c.pkg, c.conversationKey) in picked)) && (settings[c.pkg]?.record ?: true) &&
      "app:${c.pkg}" !in aiBlocks && (c.senderKey == null || "sender:${c.senderKey}" !in aiBlocks)
    return if (AutopilotAccess.mayShare(c.pkg, ok)) AutopilotItem(id, c.appLabel, c.pkg, c.sender, c.conversation, it.emailText ?: c.text, c.postedAt) else null
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

  // BackfillStore: the ledger keeps the sources, so a test says which items have a pattern (non-AI) one.
  var hasSource: (Long) -> Boolean = { false }
  var smsPackages: Set<String> = Sms.KNOWN_APPS

  override fun <T> inTransaction(block: () -> T): T = block()

  override fun unparsed(afterPostedAt: Long, afterId: Long, limit: Int): List<BackfillItem> =
    items.values
      .filter { (it.capture.postedAt > afterPostedAt || (it.capture.postedAt == afterPostedAt && it.id > afterId)) }
      .filter { it.smsHash != null || it.emailHash != null || it.capture.pkg in smsPackages || it.capture.pkg == Email.GMAIL }   // SMS and Gmail only
      .filter { it.otpExpiresAt == null && !hasSource(it.id) && (it.emailText ?: it.capture.text).isNotBlank() }
      .sortedWith(compareBy({ it.capture.postedAt }, { it.id }))
      .take(limit)
      .map {
        BackfillItem(it.id, it.capture.postedAt, it.emailText ?: it.capture.text, LedgerBackfill.channelOf(it.capture.pkg, it.smsHash != null, it.emailHash != null, smsPackages))
      }
}
