package expo.modules.notchisland.android

import android.app.Notification
import android.app.PendingIntent
import android.content.ComponentName
import android.graphics.Bitmap
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import expo.modules.notchisland.core.AlarmCard
import expo.modules.notchisland.core.AlarmSnapshot
import expo.modules.notchisland.core.MessagePeek
import expo.modules.notchisland.core.Progress
import expo.modules.notchisland.core.ProgressRing
import expo.modules.notchisland.core.ProgressSnapshot
import expo.modules.notchisland.core.RingNote
import expo.modules.notchisland.core.callActions
import expo.modules.notchisland.core.sampleSize

/**
 * Fed by HaloListener, the app's one notification listener, so access is granted once.
 * Exists so Notch may reach MediaSessionManager and see the ongoing call notification.
 * Privacy: reads only media session metadata and play state, and for calls only the
 * notification category, `when` (start time), isOngoing, the CallStyle hang-up/decline intent,
 * each action's title (matched against a keyword list, never kept) and PendingIntent, and the
 * notification key (an id, used only to match removal).
 * For progress cards, only while that switch is on: isOngoing, category, the style name, the
 * progress numbers and EXTRA_TITLE, kept in memory for the card.
 * For the progress ring, only while that switch is on: the package name, isOngoing, whether the
 * visibility is secret, the post time and EXTRA_PROGRESS, EXTRA_PROGRESS_MAX and
 * EXTRA_PROGRESS_INDETERMINATE, kept in memory for the pill. No text.
 * For a ringing alarm, only while the alarm card switch is on: category, isOngoing, whether it
 * has a full-screen intent, `when`, EXTRA_TITLE, and each action's title and semantic flag
 * (matched, never kept) and PendingIntent.
 * For message peek, only for apps on the user's allow-list while that switch is on: category,
 * isOngoing, the group-summary flag, visibility, EXTRA_TITLE and EXTRA_TEXT (from the public
 * version when private, nothing when secret) and the contentIntent, kept in memory for the card,
 * never logged or saved. Never other text.
 */
class NotchFeed(private val service: NotificationListenerService) {
  private var sessions: MediaSessionManager? = null
  private val sessionsChanged = MediaSessionManager.OnActiveSessionsChangedListener { onSessions(it) }
  private var tracked: List<MediaController> = emptyList()
  private val progress = mutableMapOf<String, ProgressSnapshot>()
  private val ring = ProgressRing(service.packageName)
  private val main = Handler(Looper.getMainLooper())
  private val ringExpired = Runnable { publishRing() }
  private val alarms = mutableMapOf<String, AlarmInfo>()
  private val sessionCallback = object : MediaController.Callback() {
    override fun onMetadataChanged(metadata: MediaMetadata?) = refresh()
    override fun onPlaybackStateChanged(state: PlaybackState?) = refresh()
  }

  fun connected(me: ComponentName) {
    val manager = service.getSystemService(MediaSessionManager::class.java) ?: return
    try {
      manager.addOnActiveSessionsChangedListener(sessionsChanged, me)
      sessions = manager
      onSessions(manager.getActiveSessions(me))
      // A call already running when the listener (re)connects.
      service.activeNotifications?.forEach(::posted)
    } catch (_: SecurityException) {
      // Access was withdrawn between connect and this call; the island keeps the clock and battery.
    }
  }

  fun disconnected() {
    sessions?.removeOnActiveSessionsChangedListener(sessionsChanged)
    sessions = null
    tracked.forEach { it.unregisterCallback(sessionCallback) }
    tracked = emptyList()
    controller = null
    NotchMedia.media = null
    NotchMedia.call = null
    progress.clear()
    NotchMedia.progress = null
    ring.clear()
    main.removeCallbacks(ringExpired)
    NotchMedia.ring = null
    alarms.clear()
    NotchMedia.alarm = null
    NotchMedia.message = null
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

  fun posted(sbn: StatusBarNotification?) {
    val n = sbn?.notification ?: return
    if (n.category == Notification.CATEGORY_CALL && sbn.isOngoing) {
      val actions = n.actions.orEmpty()
      val picked = callActions(actions.map { it.title?.toString() })
      // CallStyle keeps hang-up (decline while ringing) in extras, outside the action list.
      val styled = runCatching {
        n.extras.getParcelable(Notification.EXTRA_HANG_UP_INTENT, PendingIntent::class.java)
          ?: n.extras.getParcelable(Notification.EXTRA_DECLINE_INTENT, PendingIntent::class.java)
      }.getOrNull()
      NotchMedia.call = CallInfo(n.`when`, sbn.key, actions.getOrNull(picked.speaker)?.actionIntent, styled ?: actions.getOrNull(picked.hangUp)?.actionIntent)
      NotchMedia.changed()
    } else if (NotchMedia.call?.key == sbn.key) {
      clearCall()
    }
    progressPosted(sbn, n)
    ringPosted(sbn, n)
    alarmPosted(sbn, n)
    messagePosted(sbn, n)
  }

  fun removed(sbn: StatusBarNotification?) {
    if (sbn != null && NotchMedia.call?.key == sbn.key) clearCall()
    if (sbn != null && progress.remove(sbn.key) != null) publishProgress()
    if (sbn != null) {
      ring.removed(sbn.key, System.currentTimeMillis())
      publishRing()
    }
    if (sbn != null && alarms.remove(sbn.key) != null) publishAlarm()
    if (sbn != null && NotchMedia.message?.snap?.key == sbn.key) setMessage(null)
  }

  // Secret stays hidden. Private shows its full text only while the phone is unlocked; on the lock screen, only the public version.
  private fun shownExtras(n: Notification): android.os.Bundle? = when (n.visibility) {
    Notification.VISIBILITY_SECRET -> null
    Notification.VISIBILITY_PRIVATE ->
      if (service.getSystemService(android.app.KeyguardManager::class.java)?.isKeyguardLocked == false) n.extras else n.publicVersion?.extras
    else -> n.extras
  }

  // Another app's extras can fail to unparcel; that notification is then simply not a card.
  private fun progressPosted(sbn: StatusBarNotification, n: Notification) {
    val snapshot = runCatching {
      val x = n.extras
      val template = x.getString(Notification.EXTRA_TEMPLATE).orEmpty()
      val ownCard = "Media" in template || template.endsWith("CallStyle") || x.containsKey(Notification.EXTRA_MEDIA_SESSION)
      val max = x.getInt(Notification.EXTRA_PROGRESS_MAX, 0)
      if (!Progress.qualifies(sbn.isOngoing, n.category, max, ownCard) || !NotchPrefs.load(service).progressCards) return@runCatching null
      val title = shownExtras(n)?.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.takeIf { it.isNotBlank() } ?: return@runCatching null
      val percent = Progress.percent(x.getInt(Notification.EXTRA_PROGRESS, 0), max, x.getBoolean(Notification.EXTRA_PROGRESS_INDETERMINATE))
      ProgressSnapshot(sbn.key, sbn.packageName, title, percent, sbn.postTime)
    }.getOrNull()
    val changed = if (snapshot == null) progress.remove(sbn.key) != null else { progress[sbn.key] = snapshot; true }
    if (changed) publishProgress()
  }

  private fun publishProgress() {
    val next = Progress.newest(progress.values)
    if (next == NotchMedia.progress) return
    NotchMedia.progress = next
    NotchMedia.changed()
  }

  private fun ringPosted(sbn: StatusBarNotification, n: Notification) {
    val note = runCatching {
      if (!NotchPrefs.load(service).progressRing) return@runCatching null
      val x = n.extras
      RingNote(sbn.key, sbn.packageName, x.getInt(Notification.EXTRA_PROGRESS, 0), x.getInt(Notification.EXTRA_PROGRESS_MAX, 0), x.getBoolean(Notification.EXTRA_PROGRESS_INDETERMINATE), sbn.postTime)
    }.getOrNull()
    val now = System.currentTimeMillis()
    if (note == null) ring.removed(sbn.key, now) else ring.posted(note, sbn.isOngoing, n.visibility == Notification.VISIBILITY_SECRET, now)
    publishRing()
  }

  private fun publishRing() {
    val now = System.currentTimeMillis()
    val next = ring.shown(now)
    main.removeCallbacks(ringExpired)
    ring.nextExpiry(now)?.let { main.postDelayed(ringExpired, it - now) }
    if (next == NotchMedia.ring) return
    NotchMedia.ring = next
    NotchMedia.changed()
  }

  // Secret alarms show "Alarm", private ones their public title.
  private fun alarmPosted(sbn: StatusBarNotification, n: Notification) {
    val info = runCatching {
      if (!AlarmCard.ringing(n.category, sbn.isOngoing, n.fullScreenIntent != null) || !NotchPrefs.load(service).alarmCard) return@runCatching null
      val shown = shownExtras(n)
      val actions = n.actions.orEmpty()
      val picked = AlarmCard.actions(actions.map { it.title?.toString() }, actions.map { it.semanticAction })
      val title = AlarmCard.title(shown?.getCharSequence(Notification.EXTRA_TITLE)?.toString())
      val snap = AlarmSnapshot(sbn.key, title, n.`when`.takeIf { it > 0 } ?: sbn.postTime, sbn.postTime, picked.snooze, picked.dismiss)
      AlarmInfo(snap, actions.getOrNull(picked.snooze)?.actionIntent, actions.getOrNull(picked.dismiss)?.actionIntent)
    }.getOrNull()
    val changed = if (info == null) alarms.remove(sbn.key) != null else { alarms[sbn.key] = info; true }
    if (changed) publishAlarm()
  }

  private fun publishAlarm() {
    val next = AlarmCard.pick(alarms.values.map { it.snap })?.let { alarms[it.key] }
    if (next == NotchMedia.alarm) return
    NotchMedia.alarm = next
    NotchMedia.changed()
  }

  // Secret messages never peek; private ones show only their public title and text.
  private fun messagePosted(sbn: StatusBarNotification, n: Notification) {
    val snap = runCatching {
      val summary = n.flags and Notification.FLAG_GROUP_SUMMARY != 0
      if (!MessagePeek.qualifies(sbn.packageName, sbn.isOngoing, n.category, summary, NotchPrefs.load(service).messagePeek)) return@runCatching null
      val shown = shownExtras(n) ?: return@runCatching null
      MessagePeek.snapshot(sbn.key, sbn.packageName, shown?.getCharSequence(Notification.EXTRA_TITLE), shown?.getCharSequence(Notification.EXTRA_TEXT), sbn.postTime)
    }.getOrNull()
    val current = NotchMedia.message
    if (snap == null) {
      if (current?.snap?.key == sbn.key) setMessage(null)
    } else if (MessagePeek.next(current?.snap, snap) === snap) {
      setMessage(MessageInfo(snap, n.contentIntent))
    }
  }

  private fun setMessage(m: MessageInfo?) {
    NotchMedia.message = m
    NotchMedia.changed()
  }

  private fun clearCall() {
    NotchMedia.call = null
    NotchMedia.changed()
  }
}
