package expo.modules.haloengine.core

data class AodState(var keyguardLocked: Boolean, var charging: Boolean, var musicPlaying: Boolean, var minuteOfDay: Int)

/**
 * Decides when the always-on screen may launch. It only ever covers a locked phone (launching over an unlocked one would
 * cancel its pending lock). A power-button press shows it again every time, except after it timed out by itself:
 * then it stays off until the next unlock.
 */
class AodPolicy {
  private var timedOutSinceUnlock = false

  fun onScreenOff(s: SettingsAod, st: AodState): Boolean =
    canShow(s, st) && !timedOutSinceUnlock && triggerMet(s, st) && !QuietHours.active(s.schedule.on, s.schedule.start, s.schedule.end, st.minuteOfDay)

  /** A new notification wakes the screen even after a timeout; it still needs a locked phone and the owner's wakeScreen switch. */
  fun onNotificationWake(s: SettingsAod, st: AodState, wakeScreen: Boolean): Boolean = wakeScreen && canShow(s, st)

  fun onTimedOut() {
    timedOutSinceUnlock = true
  }

  fun onUnlocked() {
    timedOutSinceUnlock = false
  }

  /** null = never stop. */
  fun timeoutMs(s: SettingsAod): Long? = s.timeoutSec?.let { it * 1000L }

  private fun canShow(s: SettingsAod, st: AodState) = s.enabled && st.keyguardLocked

  private fun triggerMet(s: SettingsAod, st: AodState) = when (s.trigger) {
    AodTrigger.ALWAYS -> true
    AodTrigger.CHARGING -> st.charging
    AodTrigger.MUSIC -> st.musicPlaying
  }
}
