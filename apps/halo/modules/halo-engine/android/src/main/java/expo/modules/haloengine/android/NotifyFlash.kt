package expo.modules.haloengine.android

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
import expo.modules.haloengine.core.Notified
import expo.modules.haloengine.core.NotifyRules
import expo.modules.haloengine.core.PostedNote
import expo.modules.haloengine.core.QuietHours
import java.util.Calendar

/** Turns listener callbacks into edge flashes and reminder flashes. Main thread only. Reads no title or text. */
object NotifyFlash {
  private const val FILE = "halo"
  private const val NOTIFIED = "notified"
  private val main = Handler(Looper.getMainLooper())
  private var app: Context? = null
  private var rules: NotifyRules? = null
  private var unlock: BroadcastReceiver? = null
  private val ranking = NotificationListenerService.Ranking()
  private val remind = Runnable { remind() }

  fun attach(ctx: Context) {
    app = ctx.applicationContext
    if (unlock != null) return
    val r = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_USER_PRESENT) return
        rules?.onUnlocked(System.currentTimeMillis())
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
    val n = sbn.notification
    val importance = if (map?.getRanking(sbn.key, ranking) == true) ranking.importance else 0
    val note = PostedNote(sbn.key, pkg, sbn.isOngoing, importance, n.flags and Notification.FLAG_GROUP_SUMMARY != 0, n.category, sbn.postTime)
    if (!note.ongoing && pkg != c.packageName) remember(c, pkg)
    val s = SettingsStore.load(c).notify
    val minute = minuteOfDay()
    val d = rules(c).onPosted(note, s, minute, System.currentTimeMillis())
    if (d == null) {
      if (!note.ongoing && QuietHours.active(s.quiet.on, s.quiet.start, s.quiet.end, minute)) ProbeLog.log(c, "notify", "quiet hours, no flash pkg=$pkg")
      return
    }
    flash(c, d, "flash")
    schedule(c)
  }

  fun removed(key: String) {
    rules?.onRemoved(key)
    app?.let(::schedule)
  }

  fun notified(ctx: Context): Set<String> =
    Notified.parse(ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(NOTIFIED, "") ?: "").toSet()

  private fun remember(ctx: Context, pkg: String) {
    val prefs = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    Notified.add(prefs.getString(NOTIFIED, "") ?: "", pkg)?.let { prefs.edit().putString(NOTIFIED, it).apply() }
  }

  private fun rules(ctx: Context) = rules ?: NotifyRules(ctx.packageName).also { rules = it }

  private fun flash(ctx: Context, d: FlashDecision, why: String) {
    val colour = d.colour ?: AppIcons.colour(ctx, d.pkg)
    ProbeLog.log(ctx, "notify", "$why pkg=${d.pkg} colour=${"#%06X".format(colour and 0xFFFFFF)} style=${d.style}")
    HaloService.flash(ctx, d, colour)
  }

  private fun schedule(ctx: Context) {
    main.removeCallbacks(remind)
    val at = rules?.nextReminderAtMs(SettingsStore.load(ctx).notify) ?: return
    main.postDelayed(remind, maxOf(0L, at - System.currentTimeMillis()))
  }

  private fun remind() {
    val c = app ?: return
    val due = rules?.dueReminders(SettingsStore.load(c).notify, minuteOfDay(), System.currentTimeMillis()) ?: return
    due.forEach { flash(c, it, "reminder") }
    schedule(c)
  }

  private fun minuteOfDay(): Int = Calendar.getInstance().let { it.get(Calendar.HOUR_OF_DAY) * 60 + it.get(Calendar.MINUTE) }
}
