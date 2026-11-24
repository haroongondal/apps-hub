package expo.modules.audiochunks.core

// The caller passes a monotonic clock (elapsedRealtime), so elapsed time stays right with the screen off and JS timers paused.
class MeetingClock(private val startMs: Long) {
  private var stoppedMs: Long? = null
  private var silencedSince: Long? = null
  private var silencedTotal = 0L

  val silenced: Boolean get() = silencedSince != null

  fun elapsedMs(nowMs: Long): Long = maxOf(0L, (stoppedMs ?: nowMs) - startMs)

  fun setSilenced(on: Boolean, nowMs: Long) {
    if (stoppedMs != null) return
    val since = silencedSince
    if (on && since == null) silencedSince = nowMs
    if (!on && since != null) {
      silencedTotal += maxOf(0L, nowMs - since)
      silencedSince = null
    }
  }

  fun silencedMs(nowMs: Long): Long {
    val end = stoppedMs ?: nowMs
    return silencedTotal + (silencedSince?.let { maxOf(0L, end - it) } ?: 0L)
  }

  fun stop(nowMs: Long) {
    if (stoppedMs != null) return
    setSilenced(false, nowMs)
    stoppedMs = nowMs
  }
}
