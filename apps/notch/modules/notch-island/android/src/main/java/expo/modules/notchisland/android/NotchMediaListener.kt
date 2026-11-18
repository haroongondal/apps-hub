package expo.modules.notchisland.android

import android.content.ComponentName
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Exists so Notch may reach MediaSessionManager and see the ongoing call notification.
 * Privacy: reads only media session metadata and play state, and for calls only the
 * notification category, `when`, isOngoing and the action count. Never extras, text or action titles.
 */
class NotchMediaListener : NotificationListenerService() {
  private var sessions: MediaSessionManager? = null
  private val sessionsChanged = MediaSessionManager.OnActiveSessionsChangedListener { onSessions(it) }

  override fun onListenerConnected() {
    val manager = getSystemService(MediaSessionManager::class.java) ?: return
    val me = ComponentName(this, NotchMediaListener::class.java)
    try {
      manager.addOnActiveSessionsChangedListener(sessionsChanged, me)
      sessions = manager
      onSessions(manager.getActiveSessions(me))
    } catch (_: SecurityException) {
      // Access was withdrawn between connect and this call; the island keeps the clock and battery.
    }
  }

  override fun onListenerDisconnected() {
    sessions?.removeOnActiveSessionsChangedListener(sessionsChanged)
    sessions = null
    NotchMedia.media = null
    NotchMedia.call = null
    NotchMedia.changed()
  }

  // Media sessions: filled in by Task 5.
  private fun onSessions(controllers: List<MediaController>?) {}

  // Call notifications: filled in by Task 7. Read nothing from sbn here.
  override fun onNotificationPosted(sbn: StatusBarNotification?) {}

  override fun onNotificationRemoved(sbn: StatusBarNotification?) {}
}
