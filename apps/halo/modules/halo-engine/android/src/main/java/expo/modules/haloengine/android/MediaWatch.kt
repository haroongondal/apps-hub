package expo.modules.haloengine.android

import android.content.ComponentName
import android.content.Context
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper

/** Which app (if any) is playing, from the active media sessions; needs notification-listener access to HaloListener. */
class MediaWatch(private val ctx: Context, private val onChange: () -> Unit, private val onMetadata: () -> Unit) {
  private val msm = ctx.getSystemService(MediaSessionManager::class.java)
  private val main = Handler(Looper.getMainLooper())
  private var controllers: List<MediaController> = emptyList()

  var available = false
    private set
  var playingApp: String? = null
    private set
  var playing: MediaController? = null
    private set

  private val callback = object : MediaController.Callback() {
    override fun onPlaybackStateChanged(state: PlaybackState?) = refresh()
    override fun onSessionDestroyed() = refresh()
    // No controller argument, so a non-playing session's change costs one redundant recompute.
    override fun onMetadataChanged(metadata: MediaMetadata?) = onMetadata()
  }

  private val sessions = MediaSessionManager.OnActiveSessionsChangedListener { track(it.orEmpty()) }
  private var retries = 0
  private val retry = Runnable { start() }

  fun start() {
    if (available) return
    val component = ComponentName(ctx, HaloListener::class.java)
    try {
      msm.addOnActiveSessionsChangedListener(sessions, component, main)
      available = true
      track(msm.getActiveSessions(component))
      retries = 0
      ProbeLog.log(ctx, "media", "watching sessions=${controllers.size}")
    } catch (e: SecurityException) {
      // Right after listener access is granted the first call can still be refused, so try again a few times.
      if (available) runCatching { msm.removeOnActiveSessionsChangedListener(sessions) }
      available = false
      val delay = RETRY_MS.getOrNull(retries++)
      ProbeLog.log(ctx, "media", "no listener access attempt=$retries ${if (delay != null) "retry in ${delay}ms" else "giving up until the listener reconnects"}: ${e.message}")
      if (delay != null) main.postDelayed(retry, delay)
    }
  }

  fun stop() {
    main.removeCallbacks(retry)
    retries = 0
    if (available) runCatching { msm.removeOnActiveSessionsChangedListener(sessions) }
    controllers.forEach { it.unregisterCallback(callback) }
    controllers = emptyList()
    playing = null
    available = false
  }

  private fun track(list: List<MediaController>) {
    controllers.forEach { it.unregisterCallback(callback) }
    controllers = list
    list.forEach { it.registerCallback(callback, main) }
    refresh()
  }

  private fun refresh() {
    val c = controllers.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING }
    val app = c?.packageName
    if (app == playingApp && c?.sessionToken == playing?.sessionToken) return
    playing = c
    if (app == playingApp) return onChange()
    playingApp = app
    ProbeLog.log(ctx, "media", "playing=${app ?: "none"}")
    onChange()
  }

  companion object {
    private val RETRY_MS = longArrayOf(1_000L, 2_000L, 4_000L)

    /** One read for the always-on decisions, so the music trigger works while the lights (and their watch) are off; false without listener access. */
    fun isPlaying(ctx: Context): Boolean = try {
      ctx.getSystemService(MediaSessionManager::class.java).getActiveSessions(ComponentName(ctx, HaloListener::class.java))
        .any { it.playbackState?.state == PlaybackState.STATE_PLAYING }
    } catch (e: SecurityException) {
      false
    }
  }
}
