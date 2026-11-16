package expo.modules.haloengine.core

/**
 * Always-on screen spike: the clock may only cover a phone that is already locked, so it never holds an unlocked phone open,
 * and only once per lock, because the clock turns the screen on and would otherwise relaunch on every screen-off.
 */
object Aod {
  fun shouldLaunch(spikeOn: Boolean, keyguardLocked: Boolean, shownSinceUnlock: Boolean): Boolean =
    spikeOn && keyguardLocked && !shownSinceUnlock
}
