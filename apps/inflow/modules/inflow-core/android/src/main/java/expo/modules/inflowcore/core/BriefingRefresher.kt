package expo.modules.inflowcore.core

import java.util.concurrent.Executor
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean

/** Where the snapshot lives: one string, null deletes it. */
interface BriefingCache {
  fun read(): String?

  fun write(json: String?)
}

/**
 * Rebuilds the snapshot off the caller's thread ([executor] must not be a binder or main thread). [build] returns null when it cannot build (no store);
 * [enabled] is false while nobody may be served, so no reader runs for nothing. [changed] is whether the last rebuild's lines differ from the ones before it (builtAt ignored): the ping decision of the digest.
 */
class BriefingRefresher(
  private val cache: BriefingCache,
  private val build: (Long) -> List<BriefingLine>?,
  private val executor: Executor,
  private val clock: () -> Long,
  private val enabled: () -> Boolean = { true },
) {
  @Volatile var changed = false
    private set

  private val queued = AtomicBoolean(false)
  @Volatile private var lastAttempt = 0L

  fun snapshot(): BriefingSnapshot = BriefingSnapshot.parse(cache.read())

  /** Forgets the snapshot at once (a setting changed, so what it holds may be too much). */
  fun clear() = cache.write(null)

  /** Rebuilds now on this thread; false when nothing was built or the lines are the same. A failed build keeps the old snapshot. */
  @Synchronized
  fun refreshNow(): Boolean {
    if (!enabled()) return false
    val now = clock()
    val before = snapshot().lines
    val lines = runCatching { build(now) }.getOrNull()?.take(Briefing.MAX_LINES) ?: return false
    cache.write(BriefingSnapshot(now, lines).toJson())
    changed = lines != before
    return changed
  }

  /** Queues one rebuild; a request made while one is still waiting for its turn joins it. [onDone] gets [changed]. */
  fun refreshAsync(onDone: (Boolean) -> Unit = {}) {
    if (!queued.compareAndSet(false, true)) return
    try {
      executor.execute {
        queued.set(false)
        onDone(runCatching { refreshNow() }.getOrDefault(false))
      }
    } catch (e: RejectedExecutionException) {
      queued.set(false)
    }
  }

  /** For the provider: answers at once, and starts at most one rebuild when [snapshot] is missing or older than 10 minutes (and not twice within a minute). */
  fun maybeRefresh(snapshot: BriefingSnapshot) {
    val now = clock()
    if (!snapshot.stale(now) || now - lastAttempt < RETRY_MS) return
    lastAttempt = now
    refreshAsync()
  }

  companion object {
    const val RETRY_MS = 60_000L
  }
}
