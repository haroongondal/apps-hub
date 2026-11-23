package expo.modules.haloengine.core

data class AodState(var keyguardLocked: Boolean, var charging: Boolean, var musicPlaying: Boolean, var minuteOfDay: Int)

/**
 * Decides when the always-on screen may launch. It only ever covers a locked phone (launching over an unlocked one would
 * cancel its pending lock). A power-button press from the lock screen shows it again every time, except after it was
 * ended (timed out, pocket, or power pressed while it showed): then it stays off until the next unlock or a notification wake.
 */
class AodPolicy {
  private var timedOutSinceUnlock = false

  /** aodShowing: the always-on screen is in front, so this screen-off is the owner pressing power on it. */
  fun onScreenOff(s: SettingsAod, st: AodState, aodShowing: Boolean = false): Boolean {
    if (aodShowing) {
      timedOutSinceUnlock = true
      return false
    }
    return canShow(s, st) && !timedOutSinceUnlock && allowed(s, st)
  }

  /** A new notification wakes the screen even after it was ended; everything else (lock, trigger, off hours, wakeScreen) still applies. */
  fun onNotificationWake(s: SettingsAod, st: AodState, wakeScreen: Boolean): Boolean = wakeScreen && canShow(s, st) && allowed(s, st)

  fun onTimedOut() {
    timedOutSinceUnlock = true
  }

  fun onUnlocked() {
    timedOutSinceUnlock = false
  }

  /** null = never stop. */
  fun timeoutMs(s: SettingsAod): Long? = s.timeoutSec?.let { it * 1000L }

  private fun canShow(s: SettingsAod, st: AodState) = s.enabled && st.keyguardLocked

  private fun allowed(s: SettingsAod, st: AodState) =
    triggerMet(s, st) && !QuietHours.active(s.schedule.on, s.schedule.start, s.schedule.end, st.minuteOfDay)

  private fun triggerMet(s: SettingsAod, st: AodState) = when (s.trigger) {
    AodTrigger.ALWAYS -> true
    AodTrigger.CHARGING -> st.charging
    AodTrigger.MUSIC -> st.musicPlaying
  }
}
