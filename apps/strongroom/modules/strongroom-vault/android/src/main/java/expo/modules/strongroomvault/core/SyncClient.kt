package expo.modules.strongroomvault.core

import java.security.MessageDigest
import java.util.Base64

data class SyncReport(val pulled: Int, val pushed: Int, val conflicts: Int, val quarantined: Int, val blocked: Int, val headerChanged: Boolean)

class SignedIn(
  val header: Header,
  val headerRev: Long,
  val records: List<SyncRow>,
  val quarantine: List<SyncRow>,
  val skipped: Int,
  val lastRev: Long,
  val vaultKey: ByteArray,
  val loginToken: ByteArray,
  val readToken: ByteArray?,
)

object SyncClient {
  internal class PulledRow(val id: String, val rev: Long, val sealed: ByteArray?)

  internal class Pulled(val header: String, val headerRev: Long, val rows: List<PulledRow>, val skipped: Int, val latestRev: Long)

  private fun ciphertextOf(c: String?): ByteArray? = if (c == null || c.length > SyncWire.MAX_CIPHERTEXT_CHARS) null else SyncWire.fromBase64(c)

  internal fun pullAll(t: SyncTransport, token: ByteArray, since: Long): Pulled {
    val rows = LinkedHashMap<String, PulledRow>()
    var skipped = 0
    var from = since
    while (true) {
      val page = t.pull(token, from)
      if (page.latestRev < since) throw SyncRollbackError()
      var next = from
      for (r in page.records) {
        val rev = r.rev?.takeIf { it > from }
        if (rev != null) next = maxOf(next, rev)
        val id = r.id
        if (rev == null || id == null || !SyncWire.ID.matches(id)) skipped++
        else if ((rows[id]?.rev ?: 0) <= rev) rows[id] = PulledRow(id, rev, ciphertextOf(r.ciphertext))
      }
      if (!page.more) return Pulled(page.header, page.headerRev, rows.values.toList(), skipped, page.latestRev)
      if (next == from) throw SyncRollbackError() // "more" without moving forward would loop for ever
      from = next
    }
  }

  // Only ids the server accepts take part (it refuses a whole batch over one bad id): the phone's own key-check record never leaves it.
  private fun localRecords(store: SyncRecordStore) = store.syncRecords().filter { SyncWire.ID.matches(it.id) }

  private fun plan(local: List<SyncRecord>, rows: List<PulledRow>, vaultKey: ByteArray) = SyncMerge.plan(
    local.map { MergeLocal(it.id, it.rev, it.dirty, it.sealed, VaultFormat.openEntry(vaultKey, it.id, it.sealed)) },
    rows.map { r -> MergeRemote(r.id, r.rev, r.sealed ?: ByteArray(0), r.sealed?.let { VaultFormat.openEntry(vaultKey, r.id, it) }) },
  )

  private fun applied(plan: MergePlan, seen: Map<String, ByteArray>, headerRev: Long, lastRev: Long) = PullApplied(
    headerRev = headerRev,
    records = plan.adopt.map { Adopt(it.id, it.sealed, it.rev, seen[it.id]) },
    quarantine = plan.quarantine.map { SyncRow(it.id, it.sealed, it.rev) },
    rebase = plan.rebase,
    lastRev = lastRev,
  )

  /** The locked job (R18): GET with the read token into the stage only. It never touches `records` and never POSTs. */
  fun download(store: SyncRecordStore, transport: SyncTransport, readToken: ByteArray): Int {
    val meta = store.syncMeta()
    val p = pullAll(transport, readToken, maxOf(meta.lastRev, meta.pendingRev))
    if (p.headerRev < meta.headerRev) throw SyncRollbackError()
    store.stage(p.rows.map { SyncRow(it.id, it.sealed ?: ByteArray(0), it.rev) }, p.latestRev)
    return p.rows.size
  }

  // Staged rows go through the same merge and the same atomic applyPull as a network pull, with no network, so they land even offline.
  private fun mergeStage(store: SyncRecordStore, vaultKey: ByteArray): MergePlan? {
    val meta = store.syncMeta()
    val rows = store.staged().filter { it.rev > meta.lastRev }.map { PulledRow(it.id, it.rev, it.sealed.takeIf(ByteArray::isNotEmpty)) }
    if (rows.isEmpty()) return null
    val local = localRecords(store)
    val plan = plan(local, rows, vaultKey)
    store.applyPull(applied(plan, local.associate { it.id to it.sealed }, meta.headerRev, maxOf(meta.lastRev, meta.pendingRev)))
    return plan
  }

  fun syncOnce(store: SyncRecordStore, transport: SyncTransport, vaultKey: ByteArray, token: ByteArray, maxRetries: Int = 3): SyncReport {
    val staged = mergeStage(store, vaultKey)
    var pulled = staged?.adopt?.size ?: 0
    var pushed = 0
    var conflicts = staged?.conflicts ?: 0
    var quarantined = staged?.quarantine?.size ?: 0
    var headerChanged = false
    var skipped = 0
    val blocked = HashSet(staged?.blocked.orEmpty())
    var round = 0
    while (true) {
      val meta = store.syncMeta()
      val p = pullAll(transport, token, meta.lastRev)
      if (p.headerRev < meta.headerRev) throw SyncRollbackError()
      val local = localRecords(store)
      val plan = plan(local, p.rows, vaultKey)

      val sameHeader = Header.fromJson(p.header)?.let { it == store.header()?.let(Header::fromJson) } == true
      headerChanged = headerChanged || !sameHeader
      val seen = local.associate { it.id to it.sealed }
      store.applyPull(applied(plan, seen, if (sameHeader) p.headerRev else meta.headerRev, p.latestRev))
      pulled += plan.adopt.size
      conflicts += plan.conflicts
      quarantined += plan.quarantine.size
      skipped += p.skipped
      blocked += plan.blocked

      val held = store.quarantine()
      val push = plan.push.filter { q ->
        val skip = held.any { (qid, rev) -> qid == q.id && rev > q.baseRev } ||
          (seen.getValue(q.id).size + 2) / 3 * 4 > SyncWire.MAX_CIPHERTEXT_CHARS
        if (skip) blocked += q.id
        !skip
      }
      var conflicted = false
      for (chunk in push.chunked(SyncWire.MAX_UPSERTS)) {
        val res = transport.push(token, PushRequest(chunk.map { Upsert(it.id, it.baseRev, SyncWire.toBase64(seen.getValue(it.id))) }))
        if (res is PushConflict) {
          conflicted = true
          break
        }
        val revs = (res as PushResponse).revs.toMap()
        val done = chunk.mapNotNull { c -> revs[c.id]?.let { SyncRow(c.id, seen.getValue(c.id), it) } }
        store.markPushed(done)
        pushed += done.size
      }
      val report = SyncReport(pulled, pushed, conflicts, quarantined, blocked.size + skipped, headerChanged)
      if (!conflicted) return report
      if (round >= maxRetries) throw SyncHttpError(409, "Another device kept changing the same entries. Sync again in a moment.")
      round++
    }
  }

  fun adoptHeader(local: Header, remote: Header, password: CharArray, accountKey: ByteArray?, vaultKey: ByteArray): Header? {
    if (!remote.kdf.inRange() || remote.kdf.weakerThan(local.kdf)) return null
    if ((local.accountKey || accountKey != null) && !remote.accountKey) return null
    val opened = VaultFormat.openWithPassword(remote, password, accountKey) ?: return null
    opened.loginToken.fill(0)
    opened.readToken.fill(0)
    try {
      return remote.takeIf { MessageDigest.isEqual(opened.vaultKey, vaultKey) }
    } finally {
      opened.vaultKey.fill(0)
    }
  }

  fun signInWithPassword(t: SyncTransport, password: CharArray, accountKey: ByteArray? = null): SignedIn {
    val pre = t.prelogin() ?: throw SyncHttpError(404, "No sync account exists yet. Turn on sync on the phone first.")
    val keys = VaultFormat.derivePasswordKeys(password, Base64.getDecoder().decode(pre.salt), pre.kdf, pre.accountKey, accountKey)
    try {
      val (p, header) = download(t, keys.loginToken)
      // The keys came from prelogin, so a header with other settings would open now but never on this device's next unlock.
      val matches = header.kdf == pre.kdf && SyncWire.toBase64(header.salt) == pre.salt && header.accountKey == pre.accountKey
      val vaultKey = (if (matches) VaultFormat.openPasswordWrap(header, keys.wrapKey) else null) ?: throw SyncAuthError()
      return signedIn(p, header, vaultKey, keys.loginToken, keys.readToken)
    } catch (e: Exception) {
      keys.loginToken.fill(0)
      keys.readToken.fill(0)
      throw e
    } finally {
      keys.wrapKey.fill(0)
    }
  }

  fun signInWithRecovery(t: SyncTransport, recoveryKey: ByteArray): SignedIn {
    val loginToken = VaultFormat.recoveryLoginToken(recoveryKey)
    val (p, header) = download(t, loginToken)
    val vaultKey = VaultFormat.unlockWithRecovery(header, recoveryKey) ?: throw SyncAuthError()
    return signedIn(p, header, vaultKey, loginToken, null)
  }

  private fun download(t: SyncTransport, token: ByteArray): Pair<Pulled, Header> {
    val p = pullAll(t, token, 0)
    return p to (Header.fromJson(p.header) ?: throw SyncAuthError())
  }

  private fun signedIn(p: Pulled, header: Header, vaultKey: ByteArray, loginToken: ByteArray, readToken: ByteArray?): SignedIn {
    val records = ArrayList<SyncRow>()
    val quarantine = ArrayList<SyncRow>()
    var skipped = p.skipped
    for (r in p.rows) {
      val sealed = r.sealed
      if (sealed == null) skipped++
      else (if (VaultFormat.openEntry(vaultKey, r.id, sealed) != null) records else quarantine) += SyncRow(r.id, sealed, r.rev)
    }
    return SignedIn(header, p.headerRev, records, quarantine, skipped, p.latestRev, vaultKey, loginToken, readToken)
  }
}
