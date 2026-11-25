package expo.modules.inflowcore.core

import java.util.concurrent.Executor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BriefingRefresherTest {
  private class Cache(var json: String? = null) : BriefingCache {
    override fun read() = json
    override fun write(json: String?) { this.json = json }
  }

  /** Holds tasks until the test runs them: nothing happens on its own. */
  private class Queue : Executor {
    val tasks = ArrayDeque<Runnable>()
    override fun execute(command: Runnable) { tasks.addLast(command) }
    fun runAll() { while (tasks.isNotEmpty()) tasks.removeFirst().run() }
  }

  private var now = 10_000_000L
  private var lines: List<BriefingLine>? = listOf(BriefingLine(1, "bill", "Bill due 25 Nov", 5, 0))
  private var builds = 0
  private var on = true
  private val cache = Cache()
  private val queue = Queue()
  private val refresher = BriefingRefresher(cache, { builds++; lines }, queue, { now }, { on })

  @Test fun aMissingSnapshotStartsExactlyOneRebuildAndTheQueryIsAnsweredFromWhatIsThere() {
    val snap = refresher.snapshot()
    assertTrue(snap.lines.isEmpty())
    refresher.maybeRefresh(snap)
    refresher.maybeRefresh(snap)
    refresher.maybeRefresh(snap)
    assertEquals(1, queue.tasks.size)
    assertEquals(0, builds)   // nothing ran inside the query
    queue.runAll()
    assertEquals(1, builds)
    assertEquals(lines, refresher.snapshot().lines)
  }

  @Test fun aStaleSnapshotStartsOneRebuildAndAFreshOneNone() {
    cache.json = BriefingSnapshot(now - BriefingSnapshot.STALE_MS - 1, lines!!).toJson()
    refresher.maybeRefresh(refresher.snapshot())
    assertEquals(1, queue.tasks.size)
    queue.runAll()
    refresher.maybeRefresh(refresher.snapshot())   // built at now, so fresh
    assertEquals(0, queue.tasks.size)
    assertEquals(1, builds)
  }

  @Test fun aFailedRebuildIsNotRetriedWithinAMinute() {
    lines = null
    refresher.maybeRefresh(refresher.snapshot())
    queue.runAll()
    now += BriefingRefresher.RETRY_MS - 1
    refresher.maybeRefresh(refresher.snapshot())
    assertEquals(0, queue.tasks.size)
    now += 1
    refresher.maybeRefresh(refresher.snapshot())
    assertEquals(1, queue.tasks.size)
  }

  @Test fun changedComparesTheLinesByValueAndIgnoresWhenTheyWereBuilt() {
    assertTrue(refresher.refreshNow())
    assertTrue(refresher.changed)
    now += 60_000
    assertFalse(refresher.refreshNow())   // same lines, later builtAt
    assertFalse(refresher.changed)
    assertEquals(now, refresher.snapshot().builtAt)
    lines = lines!! + BriefingLine(2, "steps", "6214 steps", null, 1)
    assertTrue(refresher.refreshNow())
    assertTrue(refresher.changed)
    lines = lines!!.dropLast(1)
    assertTrue(refresher.refreshNow())
  }

  @Test fun clearForgetsTheSnapshotAtOnce() {
    refresher.refreshNow()
    refresher.clear()
    assertEquals(BriefingSnapshot.EMPTY, refresher.snapshot())
    assertTrue(refresher.refreshNow())   // lines are new against an empty cache
  }

  @Test fun aFailedBuildKeepsTheOldSnapshotAndReportsNoChange() {
    refresher.refreshNow()
    val kept = cache.json
    lines = null
    assertFalse(refresher.refreshNow())
    assertEquals(kept, cache.json)
    val thrower = BriefingRefresher(cache, { throw IllegalStateException("boom") }, queue, { now })
    assertFalse(thrower.refreshNow())
    assertEquals(kept, cache.json)
  }

  @Test fun whileNobodyMayBeServedNoReaderRunsAndNothingIsWritten() {
    on = false
    assertFalse(refresher.refreshNow())
    refresher.refreshAsync()
    queue.runAll()
    assertEquals(0, builds)
    assertEquals(null, cache.json)
  }

  @Test fun requestsWaitingForTheirTurnJoinAndALaterOneRunsAgain() {
    var done = 0
    refresher.refreshAsync { done++ }
    refresher.refreshAsync { done++ }
    assertEquals(1, queue.tasks.size)
    queue.runAll()
    assertEquals(1, done)
    refresher.refreshAsync { done++ }
    queue.runAll()
    assertEquals(2, done)
    assertEquals(2, builds)
  }

  @Test fun anExecutorThatRefusesDoesNotLeaveTheQueueBlocked() {
    var refuse = true
    val r = BriefingRefresher(cache, { builds++; lines }, { c -> if (refuse) throw java.util.concurrent.RejectedExecutionException() else c.run() }, { now })
    r.refreshAsync()
    refuse = false
    r.refreshAsync()
    assertEquals(1, builds)
  }

  @Test fun theLinesAreCappedAtTwentyBeforeTheyAreStored() {
    lines = (1..30L).map { BriefingLine(it, "tasks", "$it tasks", null, 0) }
    refresher.refreshNow()
    assertEquals(20, refresher.snapshot().lines.size)
  }

  @Test fun onChangedRunsOncePerRebuildThatChangedTheLinesAndNeverForTheSameLines() {
    var pings = 0
    val r = BriefingRefresher(cache, { builds++; lines }, queue, { now }, { on }, { pings++ })
    r.refreshNow()
    assertEquals(1, pings)
    r.refreshNow()   // same lines
    assertEquals(1, pings)
    lines = listOf(BriefingLine(1, "bill", "Bill due 26 Nov", 5, 0))
    r.refreshNow()
    assertEquals(2, pings)
    lines = null   // a failed build keeps the old snapshot and says nothing
    r.refreshNow()
    on = false
    lines = listOf(BriefingLine(2, "bill", "Bill due 27 Nov", 5, 0))
    r.refreshNow()   // sharing off: nothing built
    assertEquals(2, pings)
  }

  @Test fun aFailingOnChangedDoesNotLoseTheSnapshot() {
    val r = BriefingRefresher(cache, { builds++; lines }, queue, { now }, { on }, { throw IllegalStateException("x") })
    assertTrue(r.refreshNow())
    assertEquals(lines, r.snapshot().lines)
  }

  // BriefingRefresh.settingChanged (glue) is this call with Halo's ping as the callback, so the order and the sharing-off ping are proven here.
  @Test fun aSettingChangeForgetsTheSnapshotAtOnceThenRebuildsAndStaysQuietWhileSharing() {
    refresher.refreshNow()
    var offCalls = 0
    refresher.settingChanged { offCalls++ }
    assertEquals(BriefingSnapshot.EMPTY, refresher.snapshot())   // cleared before the rebuild gets its turn
    assertEquals(1, builds)
    queue.runAll()
    assertEquals(2, builds)
    assertEquals(lines, refresher.snapshot().lines)
    assertEquals(0, offCalls)
  }

  @Test fun aSettingChangeWithSharingOffClearsTellsTheReaderOnceAndBuildsNothing() {
    refresher.refreshNow()
    on = false
    var offCalls = 0
    refresher.settingChanged { offCalls++ }
    queue.runAll()
    assertEquals(BriefingSnapshot.EMPTY, refresher.snapshot())
    assertEquals(1, offCalls)
    assertEquals(1, builds)
  }

  @Test fun aThrowingSharingOffCallbackIsSwallowedAfterTheClearAndTheRebuildStillRuns() {
    refresher.refreshNow()
    on = false
    refresher.settingChanged { throw IllegalStateException("x") }   // must not throw out to the caller (the module setter)
    assertEquals(BriefingSnapshot.EMPTY, refresher.snapshot())
    on = true
    queue.runAll()
    assertEquals(lines, refresher.snapshot().lines)
  }
}
