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

  fun start() {
    if (available) return
    val component = ComponentName(ctx, HaloListener::class.java)
    try {
      msm.addOnActiveSessionsChangedListener(sessions, component, main)
      available = true
      track(msm.getActiveSessions(component))
      ProbeLog.log(ctx, "media", "watching sessions=${controllers.size}")
    } catch (e: SecurityException) {
      ProbeLog.log(ctx, "media", "no listener access, playing state unknown: ${e.message}")
    }
  }

  fun stop() {
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
}
