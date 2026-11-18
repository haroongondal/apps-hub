package expo.modules.notchisland.android

import android.os.SystemClock
import expo.modules.notchisland.core.TimerMode
import expo.modules.notchisland.core.TimerState

enum class TimerAction { START_PAUSE, RESET, MODE, PRESET }

/** The one timer the card and the folded indicator show. */
// shortcut: timer state lives in memory, so a service restart drops a running timer, upgrade to SharedPreferences if the owner asks for timers that survive it.
object NotchTimer {
  private val PRESETS_MS = listOf(1L, 5L, 10L, 25L).map { it * 60_000 }

  @Volatile var state: TimerState = TimerState(TimerMode.COUNTDOWN, 5 * 60_000)
  @Volatile var onChange: (() -> Unit)? = null

  fun onAction(action: TimerAction) {
    val now = SystemClock.elapsedRealtime()
    val s = state
    state = when (action) {
      TimerAction.START_PAUSE -> when {
        s.running -> s.pause(now)
        s.done(now) -> s.reset().start(now)
        else -> s.start(now)
      }
      TimerAction.RESET -> s.reset()
      TimerAction.MODE -> s.copy(mode = if (s.mode == TimerMode.COUNTDOWN) TimerMode.STOPWATCH else TimerMode.COUNTDOWN).reset()
      TimerAction.PRESET -> s.copy(durationMs = PRESETS_MS.getOrElse(PRESETS_MS.indexOf(s.durationMs) + 1) { PRESETS_MS[0] }).reset()
    }
    onChange?.invoke()
  }
}
