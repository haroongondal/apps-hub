package expo.modules.haloengine.core

enum class AudioState { OK, BLOCKED, IDLE }

/** Decides from Visualizer and media-session events whether audio is live, blocked or silent, and when to animate. */
class AudioWatch {
  private var blocked = false
  private var playing = false
  // Last non-zero FFT, or the last successful init when none came since: silence is measured from there.
  private var lastSoundMs = Long.MIN_VALUE / 2
  private var heardSinceInit = false

  fun onInit(ok: Boolean, nowMs: Long) {
    blocked = !ok
    // A failed retry hears nothing new, so it must not restart the silence clock that random motion waits on.
    if (!ok) return
    lastSoundMs = nowMs
    heardSinceInit = false
  }

  fun onFft(nonZero: Boolean, nowMs: Long) {
    if (!nonZero) return
    lastSoundMs = nowMs
    heardSinceInit = true
  }

  fun onPlaying(playing: Boolean) {
    this.playing = playing
  }

  private fun sounding(nowMs: Long) = heardSinceInit && nowMs - lastSoundMs < ACTIVE_MS

  fun state(nowMs: Long): AudioState = when {
    blocked -> AudioState.BLOCKED
    sounding(nowMs) -> AudioState.OK
    else -> AudioState.IDLE
  }

  fun useRandom(nowMs: Long): Boolean = playing && nowMs - lastSoundMs >= RANDOM_AFTER_MS

  fun animate(nowMs: Long): Boolean = (!blocked && sounding(nowMs)) || useRandom(nowMs)

  fun retryDelayMs(attempt: Int): Long = minOf(1_000L shl attempt.coerceIn(0, 6), MAX_RETRY_MS)

  private companion object {
    const val ACTIVE_MS = 500L
    const val RANDOM_AFTER_MS = 3_000L
    const val MAX_RETRY_MS = 60_000L
  }
}
