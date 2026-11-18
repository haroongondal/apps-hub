package expo.modules.haloengine.android

import android.app.KeyguardManager
import android.app.Notification
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import expo.modules.haloengine.core.FlashDecision
import expo.modules.haloengine.core.IconCount
import expo.modules.haloengine.core.NoteIcons
import expo.modules.haloengine.core.Notified
import expo.modules.haloengine.core.NotifyRules
import expo.modules.haloengine.core.PostedNote
import expo.modules.haloengine.core.QuietHours
import java.util.Calendar

/** Turns listener callbacks into edge flashes and reminder flashes. Main thread only. Reads no title or text. */
object NotifyFlash {
  private const val FILE = "halo"
  private const val NOTIFIED = "notified"
  private const val LAST_UNLOCK = "lastUnlockMs"
  private val main = Handler(Looper.getMainLooper())
  private var app: Context? = null
  private var rules: NotifyRules? = null
  private var icons: NoteIcons? = null

  /** The always-on icon row redraws when the showing notifications change. Main thread. */
  var onIcons: (() -> Unit)? = null
  private var unlock: BroadcastReceiver? = null
  private val ranking = NotificationListenerService.Ranking()
  private val remind = Runnable { remind() }

  fun attach(ctx: Context) {
    app = ctx.applicationContext
    if (unlock != null) return
    val r = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_USER_PRESENT) return
        val now = System.currentTimeMillis()
        rules?.onUnlocked(now)
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putLong(LAST_UNLOCK, now).apply()
        main.removeCallbacks(remind)
        ProbeLog.log(context, "notify", "unlocked, reminders cleared")
      }
    }
    // SystemUI sends USER_PRESENT, so a not-exported receiver never gets it; it is a protected broadcast, so no app can fake it.
    ctx.registerReceiver(r, IntentFilter(Intent.ACTION_USER_PRESENT), Context.RECEIVER_EXPORTED)
    unlock = r
  }

  fun detach(ctx: Context) {
    unlock?.let { runCatching { ctx.unregisterReceiver(it) } }
    unlock = null
    main.removeCallbacks(remind)
  }

  fun posted(ctx: Context, sbn: StatusBarNotification, map: NotificationListenerService.RankingMap?) {
    val c = ctx.applicationContext
    val pkg = sbn.packageName
    // Never flash, so skip the settings decode.
    if (sbn.isOngoing || pkg == c.packageName) return
    remember(c, pkg)
    val n = note(sbn, map)
    if (icons(c).posted(n)) onIcons?.invoke()
    val s = SettingsStore.load(c).notify
    val minute = minuteOfDay()
    val d = rules(c).onPosted(n, s, minute, System.currentTimeMillis())
    if (d == null) {
      if (QuietHours.active(s.quiet.on, s.quiet.start, s.quiet.end, minute)) ProbeLog.log(c, "notify", "quiet hours, no flash pkg=$pkg")
      return
    }
    HaloService.wake(c, d, flash(c, d, "flash"), "notification")
    schedule(c)
  }

  /** On listener connect: rebuilds the reminder state a dead process lost, from what is showing and the last unlock. */
  fun restore(ctx: Context, active: Array<StatusBarNotification>, map: NotificationListenerService.RankingMap?) {
    val c = ctx.applicationContext
    // No unlock recorded yet (first run): nothing showing is treated as unseen.
    val lastUnlock = c.getSharedPreferences(FILE, Context.MODE_PRIVATE).getLong(LAST_UNLOCK, System.currentTimeMillis())
    val r = rules(c)
    val notes = active.map { note(it, map) }
    icons(c).reset(notes)
    onIcons?.invoke()
    r.restore(notes, lastUnlock, SettingsStore.load(c).notify, ::minuteOfDay)
    ProbeLog.log(c, "notify", "restored active=${active.size} tracked=${r.trackedCount()}")
    schedule(c)
  }

  /** Settings changed (reminder period, quiet hours): the next reminder is timed again. Any thread. */
  fun settingsChanged() {
    main.post { app?.let(::schedule) }
  }

  private fun note(sbn: StatusBarNotification, map: NotificationListenerService.RankingMap?): PostedNote {
    val n = sbn.notification
    val ranked = map?.getRanking(sbn.key, ranking) == true
    val importance = if (ranked) ranking.importance else 0
    // shortcut: the system-wide "no notifications on the lock screen" switch has no public API (Settings.Secure.LOCK_SCREEN_SHOW_NOTIFICATIONS is hidden), so only the app's and the channel's SECRET hide an icon; read it if an API appears.
    val secret = n.visibility == Notification.VISIBILITY_SECRET || (ranked && ranking.lockscreenVisibilityOverride == Notification.VISIBILITY_SECRET)
    return PostedNote(
      sbn.key, sbn.packageName, sbn.isOngoing, importance, n.flags and Notification.FLAG_GROUP_SUMMARY != 0, n.category, sbn.postTime,
      n.flags and Notification.FLAG_ONLY_ALERT_ONCE != 0, secret,
    )
  }

  fun removed(key: String) {
    rules?.onRemoved(key)
    if (icons?.removed(key) == true) onIcons?.invoke()
    app?.let(::schedule)
  }

  fun notified(ctx: Context): Set<String> =
    Notified.parse(ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(NOTIFIED, "") ?: "").toSet()

  private fun remember(ctx: Context, pkg: String) {
    val prefs = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    Notified.add(prefs.getString(NOTIFIED, "") ?: "", pkg)?.let { prefs.edit().putString(NOTIFIED, it).apply() }
  }

  private fun rules(ctx: Context) = rules ?: NotifyRules(ctx.packageName).also { rules = it }

  private fun icons(ctx: Context) = icons ?: NoteIcons(ctx.packageName).also { icons = it }

  fun icons(): List<IconCount> = icons?.top() ?: emptyList()

  private fun flash(ctx: Context, d: FlashDecision, why: String): Int {
    val colour = d.colour ?: AppIcons.colour(ctx, d.pkg)
    ProbeLog.log(ctx, "notify", "$why pkg=${d.pkg} colour=${"#%06X".format(colour and 0xFFFFFF)} style=${d.style}")
    HaloService.flash(ctx, d, colour)
    return colour
  }

  private fun schedule(ctx: Context) {
    main.removeCallbacks(remind)
    val at = rules?.nextReminderAtMs(SettingsStore.load(ctx).notify) ?: return
    main.postDelayed(remind, maxOf(0L, at - System.currentTimeMillis()))
  }

  private fun remind() {
    val c = app ?: return
    val due = rules?.dueReminders(SettingsStore.load(c).notify, minuteOfDay(), System.currentTimeMillis()) ?: return
    // Reminders are for a phone nobody is using; while unlocked the clock still advances, as in quiet hours.
    if (c.getSystemService(KeyguardManager::class.java).isKeyguardLocked) {
      due.forEachIndexed { i, d -> flash(c, d, "reminder").let { if (i == 0) HaloService.wake(c, d, it, "reminder") } }
    } else if (due.isNotEmpty()) ProbeLog.log(c, "notify", "reminder skipped: unlocked n=${due.size}")
    schedule(c)
  }

  private fun minuteOfDay(): Int = minuteOfDay(System.currentTimeMillis())

  private fun minuteOfDay(ms: Long): Int = Calendar.getInstance().apply { timeInMillis = ms }.let { it.get(Calendar.HOUR_OF_DAY) * 60 + it.get(Calendar.MINUTE) }
}
