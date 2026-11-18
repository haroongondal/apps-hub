package expo.modules.notchisland.core

enum class TimerMode { COUNTDOWN, STOPWATCH }

/** Timer or stopwatch as plain data; the view passes `now` (elapsed-realtime ms) in. */
data class TimerState(
  val mode: TimerMode,
  val durationMs: Long,
  val accumulatedMs: Long = 0,
  val startedAt: Long? = null,
) {
  val running: Boolean get() = startedAt != null

  fun elapsed(now: Long): Long = maxOf(0L, accumulatedMs + (startedAt?.let { now - it } ?: 0L))

  fun remaining(now: Long): Long =
    if (mode == TimerMode.COUNTDOWN) maxOf(0L, durationMs - elapsed(now)) else 0L

  fun done(now: Long): Boolean = mode == TimerMode.COUNTDOWN && elapsed(now) >= durationMs

  fun start(now: Long): TimerState = if (running) this else copy(startedAt = now)

  fun pause(now: Long): TimerState =
    if (!running) this else copy(accumulatedMs = elapsed(now), startedAt = null)

  fun reset(): TimerState = copy(accumulatedMs = 0, startedAt = null)
}
