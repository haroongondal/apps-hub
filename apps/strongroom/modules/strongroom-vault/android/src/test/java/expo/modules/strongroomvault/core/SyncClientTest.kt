package expo.modules.strongroomvault.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

private const val T = 1_800_000_000_000L
private val header = Header(1, KdfParams(65536, 3, 1), ByteArray(16), ByteArray(60), ByteArray(60), true)

internal fun id(n: Int) = "00000000-0000-4000-8000-" + n.toString().padStart(12, '0')

internal fun b64(b: ByteArray): String = java.util.Base64.getEncoder().encodeToString(b)

// A server with the Worker's rules: one global rev counter, a stale baseRev is a 409 and nothing is written.
private class Server {
  val rows = LinkedHashMap<String, WireRecord>()
  var latestRev = 0L
  val calls = ArrayList<String>()
  var headerJson = header.toJson()
  var headerRev = 1L

  fun put(rid: String, sealed: ByteArray) {
    rows[rid] = WireRecord(rid, ++latestRev, b64(sealed))
  }

  val t: SyncTransport = object : SyncTransport {
    override fun prelogin(): Prelogin? = null

    override fun pull(token: ByteArray, since: Long): PullResponse {
      calls += "pull $since"
      return PullResponse(headerJson, headerRev, rows.values.filter { it.rev!! > since }.sortedBy { it.rev }, latestRev, false)
    }

    override fun push(token: ByteArray, req: PushRequest): PushResult {
      calls += "push " + req.upserts.joinToString(" ") { "${it.id.takeLast(2)}@${it.baseRev}" }
      val conflicts = req.upserts.filter { (rows[it.id]?.rev ?: 0) != it.baseRev }.map { it.id to (rows[it.id]?.rev ?: 0) }
      if (conflicts.isNotEmpty()) return PushConflict(conflicts)
      for (u in req.upserts) rows[u.id] = WireRecord(u.id, ++latestRev, u.ciphertext)
      return PushResponse(req.upserts.map { it.id to rows.getValue(it.id).rev }, latestRev)
    }

    override fun putAccount(setupToken: String, body: AccountCreate): Long = error("not used")

    override fun putAccount(token: ByteArray, body: AccountUpdate): Long = error("not used")

    override fun lostRequest(claimHash: String) = error("not used")

    override fun lostRelease(claim: String): LostRelease = error("not used")

    override fun lostStatus(token: ByteArray): LostStatus = error("not used")

    override fun lostCancel(token: ByteArray) = error("not used")

    override fun deleteEscrow(token: ByteArray) = error("not used")
  }
}

class SyncClientTest {
  private val vaultKey = Crypto.randomBytes(32)

  private fun login(name: String, updatedAt: Long = T) = Entry.Login(name, "me", "pw", emptyList(), emptyList(), "", updatedAt)

  private fun seal(n: Int, e: Entry = login("entry $n")) = VaultFormat.sealEntry(vaultKey, id(n), e)

  private fun device(lastRev: Long = 0) = MemoryRecordStore().apply {
    headerJson = header.toJson()
    meta = SyncMeta(lastRev, 1)
  }

  private fun sync(store: SyncRecordStore, t: SyncTransport, maxRetries: Int = 3) =
    SyncClient.syncOnce(store, t, vaultKey, ByteArray(32), maxRetries)

  private fun st(sealed: ByteArray, rev: Long, dirty: Boolean) = Triple(sealed.toList(), rev, dirty)

  private fun MemoryRecordStore.synced(rid: String, sealed: ByteArray, rev: Long) {
    records[rid] = sealed
    revs[rid] = rev
  }

  @Test fun freshDeviceOnlyPulls() {
    val s = Server()
    for (n in 1..3) s.put(id(n), seal(n))
    val store = device()
    assertEquals(SyncReport(3, 0, 0, 0, 0, false), sync(store, s.t))
    assertEquals(listOf("pull 0"), s.calls)
    assertEquals(listOf(id(1), id(2), id(3)), store.records.keys.sorted())
    for ((rid, sealed) in store.records) assertTrue(VaultFormat.openEntry(vaultKey, rid, sealed) is Entry.Login)
    assertTrue(store.dirty.isEmpty())
    assertEquals(SyncMeta(3, 1), store.meta)
  }

  @Test fun pullsInPagesAndAdvancesLastRevOnlyWithTheBatch() {
    fun wire(n: Int) = WireRecord(id(n), n + 4L, b64(seal(n)))
    val pages = listOf(
      PullResponse(header.toJson(), 1, listOf(wire(1), wire(2)), 7, true),
      PullResponse(header.toJson(), 1, listOf(wire(3)), 7, false),
    )
    val froms = ArrayList<Long>()
    var failSecond = true
    val t = object : SyncTransport by Server().t {
      override fun pull(token: ByteArray, since: Long): PullResponse {
        froms += since
        if (since == 6L && failSecond) throw SyncOfflineError()
        return if (since == 4L) pages[0] else pages[1]
      }
    }
    val store = device(4)
    assertThrows(SyncOfflineError::class.java) { sync(store, t) }
    assertEquals(SyncMeta(4, 1), store.meta)
    assertEquals(0, store.records.size)
    assertEquals(0, store.writes)
    failSecond = false
    assertEquals(3, sync(store, t).pulled)
    assertEquals(listOf(4L, 6L, 4L, 6L), froms)
    assertEquals(SyncMeta(7, 1), store.meta)
    assertEquals(3, store.records.size)
    assertEquals(1, store.writes)
  }

  @Test fun pushRetriesAfter409UpToMaxRetries() {
    val s = Server()
    val store = device()
    store.putAll(mapOf(id(1) to seal(1)))
    var refusals = 2
    val flaky = object : SyncTransport by s.t {
      override fun push(token: ByteArray, req: PushRequest) =
        if (refusals-- > 0) PushConflict(listOf(id(1) to 0L)) else s.t.push(token, req)
    }
    assertEquals(1, sync(store, flaky, 3).pushed)
    assertEquals(3, s.calls.count { it.startsWith("pull") })
    assertFalse(id(1) in store.dirty)

    val other = device()
    other.putAll(mapOf(id(2) to seal(2)))
    var pushes = 0
    val never = object : SyncTransport by s.t {
      override fun push(token: ByteArray, req: PushRequest): PushResult {
        pushes++
        return PushConflict(listOf(id(2) to 0L))
      }
    }
    assertEquals(409, assertThrows(SyncHttpError::class.java) { sync(other, never, 2) }.status)
    assertEquals(3, pushes)
    assertTrue(id(2) in other.dirty)
  }

  @Test fun markPushedKeepsEditsMadeDuringThePush() {
    val s = Server()
    val store = device()
    store.putAll(linkedMapOf(id(1) to seal(1), id(2) to seal(2)))
    val edited = seal(1, login("edited while pushing", T + 1))
    val racing = object : SyncTransport by s.t {
      override fun push(token: ByteArray, req: PushRequest): PushResult {
        store.putAll(mapOf(id(1) to edited))
        return s.t.push(token, req)
      }
    }
    assertEquals(2, sync(store, racing).pushed)
    assertEquals(st(edited, 1, true), store.state(id(1)))
    assertFalse(id(2) in store.dirty)
    val next = sync(store, s.t)
    assertEquals(listOf(1, 0), listOf(next.pushed, next.conflicts))
    assertEquals(st(edited, 3, false), store.state(id(1)))
  }

  @Test fun interruptedPushIsNotAConflict() {
    val s = Server()
    val store = device()
    val sealed = seal(1)
    store.putAll(mapOf(id(1) to sealed))
    s.put(id(1), sealed)
    assertEquals(SyncReport(1, 0, 0, 0, 0, false), sync(store, s.t))
    assertEquals(listOf("pull 0"), s.calls)
    assertEquals(st(sealed, 1, false), store.state(id(1)))
  }

  @Test fun authFailureStopsAndAsksToSignIn() {
    val store = device(5)
    store.putAll(mapOf(id(1) to seal(1)))
    val writes = store.writes
    var calls = 0
    val refused = object : SyncTransport by Server().t {
      override fun pull(token: ByteArray, since: Long): PullResponse {
        calls++
        throw SyncAuthError()
      }
    }
    assertThrows(SyncAuthError::class.java) { sync(store, refused) }
    assertEquals(1, calls)
    assertEquals(writes, store.writes)
  }

  @Test fun rollbackIsReportedAndDeletesNothing() {
    val s = Server()
    s.put(id(1), seal(1))
    val store = device(10)
    store.putAll(mapOf(id(2) to seal(2)))
    val before = store.state(id(2))
    assertThrows(SyncRollbackError::class.java) { sync(store, s.t) }
    assertEquals(1, store.writes)
    assertEquals(listOf(id(2)), store.records.keys.toList())
    assertEquals(before, store.state(id(2)))
    assertEquals(SyncMeta(10, 1), store.meta)
    assertEquals(listOf("pull 10"), s.calls)

    val headerBack = device(0)
    headerBack.meta = SyncMeta(0, 2)
    assertThrows(SyncRollbackError::class.java) { sync(headerBack, s.t) }
    assertEquals(0, headerBack.writes)
  }

  @Test fun badRowsAreSkippedAndReported() {
    val good = WireRecord(id(1), 1, b64(seal(1)))
    val records = listOf(
      good,
      WireRecord("ABCDEF00-0000-4000-8000-000000000002", 2, good.ciphertext),
      WireRecord(id(3), 3, "A".repeat(90_004)),
      WireRecord(id(4), 4, "not*base64"),
      WireRecord(null, 5, good.ciphertext),
      WireRecord(id(6), null, good.ciphertext),
    )
    val t = object : SyncTransport by Server().t {
      override fun pull(token: ByteArray, since: Long) = PullResponse(header.toJson(), 1, records, 6, false)
    }
    val store = device()
    store.putAll(mapOf(id(3) to seal(3)))
    assertEquals(SyncReport(1, 0, 0, 2, 5, false), sync(store, t))
    assertEquals(listOf(id(1), id(3)), store.records.keys.sorted())
    assertTrue(id(3) in store.dirty)
    assertEquals(listOf(id(3) to 3L, id(4) to 4L), store.quarantine())
  }

  @Test fun quarantinedRecordIsNeverUploadedOverLater() {
    val s = Server()
    val store = device()
    store.putAll(mapOf(id(1) to seal(1)))
    s.put(id(1), Crypto.randomBytes(60))
    assertEquals(SyncReport(0, 0, 0, 1, 1, false), sync(store, s.t))
    val again = sync(store, s.t)
    assertEquals(listOf(0, 1), listOf(again.pushed, again.blocked))
    assertFalse(s.calls.any { it.startsWith("push") })
    assertTrue(id(1) in store.dirty)
  }

  @Test fun differentHeaderIsReportedNotWritten() {
    val s = Server()
    s.headerJson = header.copy(salt = ByteArray(16) { 7 }).toJson()
    val store = device()
    assertTrue(sync(store, s.t).headerChanged)
    assertEquals(header.toJson(), store.headerJson)
  }

  @Test fun oversizeLocalRecordIsSkippedAndReported() {
    val s = Server()
    val strict = object : SyncTransport by s.t {
      override fun push(token: ByteArray, req: PushRequest): PushResult {
        if (req.upserts.any { it.ciphertext.length > 90_000 }) throw SyncHttpError(413)
        return s.t.push(token, req)
      }
    }
    val store = device()
    val huge = seal(2, Entry.Note("huge", "x".repeat(70_000), T))
    store.putAll(linkedMapOf(id(1) to seal(1), id(2) to huge))
    val report = sync(store, strict)
    assertEquals(listOf(1, 1), listOf(report.pushed, report.blocked))
    assertEquals(listOf(id(1)), s.rows.keys.toList())
    assertEquals(st(huge, 0, true), store.state(id(2)))
    assertEquals(1, sync(store, strict).blocked)
  }

  @Test fun localWinnerKeepsTheRemoteBaseWhenItsPushFails() {
    val s = Server()
    val v1 = seal(1, login("v1", T))
    s.put(id(1), v1)
    val store = device(1)
    store.synced(id(1), v1, 1)
    s.put(id(1), seal(1, login("theirs", T + 1)))
    val mine = seal(1, login("mine", T + 2))
    store.putAll(mapOf(id(1) to mine))
    val offline = object : SyncTransport by s.t {
      override fun push(token: ByteArray, req: PushRequest): PushResult = throw SyncOfflineError()
    }
    assertThrows(SyncOfflineError::class.java) { sync(store, offline) }
    assertEquals(st(mine, 2, true), store.state(id(1)))
    assertEquals(2L, store.meta.lastRev)
    val report = sync(store, s.t)
    assertEquals(listOf(1, 0), listOf(report.pushed, report.conflicts))
    assertEquals("push 01@2", s.calls.last())
    assertFalse(id(1) in store.dirty)
  }

  @Test fun twoConflictsWithA409OnOneConverge() {
    val s = Server()
    val store = device()
    val mine = listOf(seal(1, login("mine", T + 5)), seal(2, login("mine", T + 5)))
    store.putAll(linkedMapOf(id(1) to mine[0], id(2) to mine[1]))
    s.put(id(1), seal(1, login("theirs", T)))
    s.put(id(2), seal(2, login("theirs", T)))
    var raced = false
    val racing = object : SyncTransport by s.t {
      override fun push(token: ByteArray, req: PushRequest): PushResult {
        if (!raced) s.put(id(2), seal(2, login("a third device", T + 1)))
        raced = true
        return s.t.push(token, req)
      }
    }
    val report = sync(store, racing)
    assertEquals(listOf(2, 3), listOf(report.pushed, report.conflicts))
    for (n in 1..2) {
      assertFalse(id(n) in store.dirty)
      assertEquals(b64(mine[n - 1]), s.rows.getValue(id(n)).ciphertext)
    }
  }

  @Test fun shortenedOversizeWinnerPushesOnTheRemoteBase() {
    val s = Server()
    val store = device()
    store.putAll(mapOf(id(1) to seal(1, Entry.Note("huge", "x".repeat(70_000), T + 5))))
    s.put(id(1), seal(1, Entry.Note("theirs", "t", T)))
    val first = sync(store, s.t)
    assertEquals(listOf<Any>(0, 1, 1, 1L), listOf(first.pushed, first.blocked, first.conflicts, store.revs[id(1)]))
    store.putAll(mapOf(id(1) to seal(1, Entry.Note("short", "s", T + 6))))
    val second = sync(store, s.t)
    assertEquals(listOf<Any>(1, 0, false), listOf(second.pushed, second.blocked, id(1) in store.dirty))
  }

  @Test fun unreadableLocalIsRebasedSoALaterRewritePushes() {
    val s = Server()
    s.put(id(1), seal(1, login("v1", T)))
    val store = device(1)
    val garbage = Crypto.randomBytes(60)
    store.synced(id(1), garbage, 1)
    s.put(id(1), seal(1, login("theirs", T + 1)))
    val first = sync(store, s.t)
    assertEquals(listOf<Any>(1, 0, 2L), listOf(first.blocked, first.pulled, store.meta.lastRev))
    assertEquals(st(garbage, 2, false), store.state(id(1)))
    store.putAll(mapOf(id(1) to seal(1, login("rewritten", T + 5))))
    val second = sync(store, s.t)
    assertEquals(listOf(1, 0, 0), listOf(second.pushed, second.blocked, second.conflicts))
    assertEquals("push 01@2", s.calls.last())
  }

  @Test fun unreadableLocalSurvivesAPull() {
    val s = Server()
    val store = device()
    val x = Crypto.randomBytes(60)
    val y = Crypto.randomBytes(60)
    store.synced(id(1), x, 1)
    store.synced(id(2), y, 1)
    store.dirty += id(2)
    s.put(id(9), seal(9))
    s.put(id(1), seal(1))
    val report = sync(store, s.t)
    assertEquals(listOf(1, 0, 2), listOf(report.pulled, report.pushed, report.blocked))
    assertEquals(listOf(st(x, 2, false), st(y, 1, true)), listOf(store.state(id(1)), store.state(id(2))))
  }

  @Test fun applyPullKeepsAnEditMadeDuringTheSync() {
    val s = Server()
    val v1 = seal(1, login("v1", T))
    s.put(id(1), v1)
    val store = device(1)
    store.synced(id(1), v1, 1)
    s.put(id(1), seal(1, login("theirs", T + 1)))
    val two = seal(2)
    s.put(id(2), two)
    val mine = seal(1, login("edited during the sync", T + 2))
    var edits = 1
    val racing = object : SyncRecordStore by store {
      override fun applyPull(p: PullApplied) {
        if (edits-- > 0) store.putAll(mapOf(id(1) to mine))
        store.applyPull(p)
      }
    }
    sync(racing, s.t)
    assertEquals(st(mine, 1, true), store.state(id(1)))
    assertEquals(st(two, 3, false), store.state(id(2)))
    // lastRev stays put, so the next sync sees the remote again and settles it by last writer wins instead of a 409 for ever.
    assertEquals(SyncMeta(1, 1), store.meta)
    val next = sync(store, s.t)
    assertEquals(listOf(1, 1), listOf(next.pushed, next.conflicts))
    assertEquals("push 01@2", s.calls.last())
    assertEquals(st(mine, 4, false), store.state(id(1)))
  }

  @Test fun deviceOnlyRecordsNeverLeaveThePhone() {
    val s = Server()
    val store = device()
    store.putAll(linkedMapOf("key-check" to VaultFormat.sealEntry(vaultKey, "key-check", Entry.Deleted(T)), id(1) to seal(1)))
    assertEquals(SyncReport(0, 1, 0, 0, 0, false), sync(store, s.t))
    assertEquals(listOf(id(1)), s.rows.keys.toList())
    assertTrue("key-check" in store.dirty)
  }

  // The stored headerRev is the ifRev of the next account update, so a header this phone hasn't adopted must not move it.
  @Test fun aDifferentHeaderDoesNotAdvanceTheStoredHeaderRev() {
    val s = Server()
    s.headerJson = header.copy(salt = ByteArray(16) { 1 }).toJson()
    s.headerRev = 5
    val store = device()
    assertTrue(sync(store, s.t).headerChanged)
    assertEquals(SyncMeta(0, 1), store.meta)
    assertEquals(header.toJson(), store.headerJson)
    s.headerJson = header.toJson()
    assertFalse(sync(store, s.t).headerChanged)
    assertEquals(SyncMeta(0, 5), store.meta)
  }

  @Test fun stagedRowsGoThroughTheNormalMergeBeforeTheNetwork() {
    val s = Server()
    s.put(id(1), seal(1, login("theirs", T)))
    s.put(id(2), seal(2))
    val store = device()
    val mine = seal(1, login("mine", T + 1))
    store.putAll(mapOf(id(1) to mine))
    store.stage(s.rows.values.map { SyncRow(it.id!!, java.util.Base64.getDecoder().decode(it.ciphertext), it.rev!!) }, 2)
    val offline = object : SyncTransport by s.t {
      override fun pull(token: ByteArray, since: Long): PullResponse = throw SyncOfflineError()
    }
    assertThrows(SyncOfflineError::class.java) { sync(store, offline) }
    assertEquals(st(mine, 1, true), store.state(id(1))) // the newer local edit won and took the staged rev as its base
    assertEquals(st(java.util.Base64.getDecoder().decode(s.rows.getValue(id(2)).ciphertext), 2, false), store.state(id(2)))
    assertTrue(store.staged().isEmpty())
    assertEquals(SyncMeta(2, 1), store.meta)
    val next = sync(store, s.t)
    assertEquals(listOf(1, 0), listOf(next.pushed, next.conflicts))
    assertEquals("push 01@1", s.calls.last())
  }
}
