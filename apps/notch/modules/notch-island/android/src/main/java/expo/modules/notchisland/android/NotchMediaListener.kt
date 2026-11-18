package expo.modules.notchisland.android

import android.app.Notification
import android.content.ComponentName
import android.graphics.Bitmap
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import expo.modules.notchisland.core.sampleSize

/**
 * Exists so Notch may reach MediaSessionManager and see the ongoing call notification.
 * Privacy: reads only media session metadata and play state, and for calls only the
 * notification category, `when`, isOngoing and its actions' PendingIntents. Never extras, text or action titles.
 */
class NotchMediaListener : NotificationListenerService() {
  private var sessions: MediaSessionManager? = null
  private val sessionsChanged = MediaSessionManager.OnActiveSessionsChangedListener { onSessions(it) }
  private var tracked: List<MediaController> = emptyList()
  private val sessionCallback = object : MediaController.Callback() {
    override fun onMetadataChanged(metadata: MediaMetadata?) = refresh()
    override fun onPlaybackStateChanged(state: PlaybackState?) = refresh()
  }

  override fun onListenerConnected() {
    val manager = getSystemService(MediaSessionManager::class.java) ?: return
    val me = ComponentName(this, NotchMediaListener::class.java)
    try {
      manager.addOnActiveSessionsChangedListener(sessionsChanged, me)
      sessions = manager
      onSessions(manager.getActiveSessions(me))
      // A call already running when the listener (re)connects.
      activeNotifications?.forEach(::onNotificationPosted)
    } catch (_: SecurityException) {
      // Access was withdrawn between connect and this call; the island keeps the clock and battery.
    }
  }

  override fun onListenerDisconnected() {
    sessions?.removeOnActiveSessionsChangedListener(sessionsChanged)
    sessions = null
    tracked.forEach { it.unregisterCallback(sessionCallback) }
    tracked = emptyList()
    controller = null
    NotchMedia.media = null
    NotchMedia.call = null
    NotchMedia.changed()
  }

  private fun onSessions(controllers: List<MediaController>?) {
    tracked.forEach { it.unregisterCallback(sessionCallback) }
    tracked = controllers.orEmpty()
    tracked.forEach { it.registerCallback(sessionCallback) }
    refresh()
  }

  private fun refresh() {
    val chosen = tracked.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING }
      ?: tracked.firstOrNull { !it.metadata?.getString(MediaMetadata.METADATA_KEY_TITLE).isNullOrBlank() }
    controller = chosen
    NotchMedia.media = chosen?.let { c ->
      val m = c.metadata
      val art = m?.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART) ?: m?.getBitmap(MediaMetadata.METADATA_KEY_ART)
      MediaInfo(
        title = m?.getString(MediaMetadata.METADATA_KEY_TITLE),
        artist = m?.getString(MediaMetadata.METADATA_KEY_ARTIST),
        art = art?.let(::thumb),
        playing = c.playbackState?.state == PlaybackState.STATE_PLAYING,
      )
    }
    NotchMedia.changed()
  }

  // The session hands over a decoded Bitmap, so inSampleSize cannot apply; scale by the same factor instead.
  private fun thumb(b: Bitmap): Bitmap {
    val s = sampleSize(b.width, b.height, 96)
    return if (s == 1) b else Bitmap.createScaledBitmap(b, (b.width / s).coerceAtLeast(1), (b.height / s).coerceAtLeast(1), true)
  }

  companion object {
    /** The chosen session, for the row's previous, play/pause and next buttons. */
    @Volatile var controller: MediaController? = null
  }

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    val n = sbn?.notification ?: return
    if (n.category == Notification.CATEGORY_CALL && sbn.isOngoing) {
      val actions = n.actions.orEmpty().map { it.actionIntent }
      NotchMedia.call = CallInfo(startedAt = n.`when`, actionCount = actions.size, key = sbn.key, actions = actions)
      NotchMedia.changed()
    } else if (NotchMedia.call?.key == sbn.key) {
      clearCall()
    }
  }

  override fun onNotificationRemoved(sbn: StatusBarNotification?) {
    if (sbn != null && NotchMedia.call?.key == sbn.key) clearCall()
  }

  private fun clearCall() {
    NotchMedia.call = null
    NotchMedia.changed()
  }
}
