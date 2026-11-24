package expo.modules.inflowcore.android

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.CalendarContract
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.inflowcore.R
import expo.modules.inflowcore.applink.AppLinkTarget
import expo.modules.inflowcore.core.AUTOPILOT_META
import expo.modules.inflowcore.core.AutopilotSettings
import expo.modules.inflowcore.core.RunPlan
import expo.modules.inflowcore.core.Suggestion
import expo.modules.inflowcore.core.SuggestionActions
import expo.modules.inflowcore.core.SuggestionKind
import expo.modules.inflowcore.core.SuggestionMoves
import expo.modules.inflowcore.core.SuggestionState
import java.time.ZoneId

/** The suggestion cards and Run. Every decision is in the pure SuggestionActions.plan; this only carries it out. */
object SuggestionNotifier {
  const val CHANNEL = "autopilot"
  const val CHANNEL_REPLY = "autopilot_reply"
  const val EXTRA_ID = "id"
  const val EXTRA_TITLE = "title"
  const val EXTRA_PKG = "pkg"
  private const val TAG = "autopilot"
  private const val TAG_REMINDER = "autopilot-reminder"
  private const val DEPUTY = "com.haroon.deputy"
  private const val DEPUTY_ACTIVITY = "expo.modules.deputyagent.android.RunSuggestionActivity"
  private const val CONTENT_CODE_BASE = 1_000_000   // keeps the card's tap clear of ReportNotifier's request codes
  private const val HOUR_MS = 3_600_000L
  private val FLAGS = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
  private val APP_CATEGORIES = listOf(Intent.CATEGORY_APP_CONTACTS, Intent.CATEGORY_APP_MAPS, Intent.CATEGORY_APP_CALENDAR, Intent.CATEGORY_APP_GALLERY)

  /** One card per suggestion: a heads-up for a reply, silent for the rest. Does nothing when notifications are off. */
  fun post(ctx: Context, s: Suggestion) {
    if (!ReportNotifier.allowed(ctx)) return
    val manager = NotificationManagerCompat.from(ctx)
    manager.createNotificationChannel(NotificationChannel(CHANNEL, "Suggestions", NotificationManager.IMPORTANCE_LOW))
    manager.createNotificationChannel(NotificationChannel(CHANNEL_REPLY, "Reply suggestions", NotificationManager.IMPORTANCE_HIGH))
    val channel = if (s.kind == SuggestionKind.REPLY) CHANNEL_REPLY else CHANNEL
    val code = s.id.toInt()
    // Run is an activity, not a receiver: Android 12+ blocks starting an activity (Deputy's) from a notification trampoline receiver.
    val run = PendingIntent.getActivity(ctx, code, Intent(ctx, SuggestionRunActivity::class.java).putExtra(EXTRA_ID, s.id), FLAGS)
    val skip = PendingIntent.getBroadcast(ctx, code, Intent(ctx, SuggestionSkipReceiver::class.java).putExtra(EXTRA_ID, s.id), FLAGS)
    val public = NotificationCompat.Builder(ctx, channel).setSmallIcon(R.drawable.inflow_report).setContentTitle("Inflow has a suggestion").build()
    val builder = NotificationCompat.Builder(ctx, channel)
      .setSmallIcon(R.drawable.inflow_report).setContentTitle(s.title)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPublicVersion(public)
      .setAutoCancel(true).setOnlyAlertOnce(true)
      .addAction(0, "Run", run).addAction(0, "Skip", skip)
    ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.let {
      builder.setContentIntent(PendingIntent.getActivity(ctx, CONTENT_CODE_BASE + code, it, FLAGS))
    }
    manager.notify(TAG, code, builder.build())
  }

  fun cancel(ctx: Context, id: Long) = NotificationManagerCompat.from(ctx).cancel(TAG, id.toInt())

  /** Carries out Run for one suggestion from any context. Returns what to tell the owner, or null when it worked. */
  fun run(ctx: Context, id: Long): String? {
    val app = ctx.applicationContext
    val store = StoreHolder.get(app).getOrNull() ?: return "Inflow couldn't open its data."
    val suggestions = SqlSuggestionStore(store.db)
    val now = System.currentTimeMillis()
    suggestions.expire(now)
    val s = suggestions.get(id) ?: return SuggestionActions.GONE
    val settings = AutopilotSettings.fromJson(store.meta(AUTOPILOT_META))
    val plan = SuggestionActions.plan(s, now, ZoneId.systemDefault(), deputyInstalled(app), settings)
    // A reply is left WAITING here: Deputy marks it started and done, so a failed start (service off, Deputy busy) can be tried again.
    val error = when (plan) {
      is RunPlan.Refuse -> {
        if (s.state != SuggestionState.WAITING || plan.message == SuggestionActions.GONE) cancel(app, id)
        return plan.message
      }
      is RunPlan.OpenCalendar -> openCalendar(app, plan)
      is RunPlan.Remind -> remind(app, s, plan, settings)
      is RunPlan.OpenApp -> openApp(app, plan)
      RunPlan.AskDeputy -> askDeputy(app, id, settings)
    }
    if (error != null) return error
    if (plan != RunPlan.AskDeputy) SuggestionMoves.move(suggestions, id, SuggestionState.DONE, System.currentTimeMillis())
    cancel(app, id)
    return null
  }

  private fun deputyInstalled(ctx: Context) =
    try { ctx.packageManager.getPackageInfo(DEPUTY, 0); true } catch (e: PackageManager.NameNotFoundException) { false }

  private fun start(ctx: Context, intent: Intent, missing: String): String? =
    try { ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); null } catch (e: ActivityNotFoundException) { missing } catch (e: SecurityException) { missing }

  private fun openCalendar(ctx: Context, p: RunPlan.OpenCalendar): String? {
    val i = Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI)
      .putExtra(CalendarContract.Events.TITLE, p.title)
      .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, p.startAt)
      .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, p.startAt + HOUR_MS)
    // The default calendar reminder: the alarm clock would need the SET_ALARM permission.
    if (p.alarmBefore) i.putExtra(CalendarContract.Events.HAS_ALARM, true)
    return start(ctx, i, "No calendar app is installed.")
  }

  private fun remind(ctx: Context, s: Suggestion, p: RunPlan.Remind, settings: AutopilotSettings): String? {
    val i = Intent(ctx, SuggestionReminderReceiver::class.java).putExtra(EXTRA_ID, s.id).putExtra(EXTRA_TITLE, s.title).putExtra(EXTRA_PKG, settings.bankApp)
    val pi = PendingIntent.getBroadcast(ctx, s.id.toInt(), i, FLAGS)
    // shortcut: reminders are lost on reboot, upgrade with a BOOT receiver if it matters.
    ctx.getSystemService(AlarmManager::class.java).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, p.at, pi)
    return null
  }

  private fun openApp(ctx: Context, p: RunPlan.OpenApp): String? {
    val launch = p.pkg?.let { ctx.packageManager.getLaunchIntentForPackage(it) } ?: ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
    return start(ctx, launch ?: return "Inflow couldn't be opened.", "That app isn't installed.")
  }

  private fun askDeputy(ctx: Context, id: Long, settings: AutopilotSettings): String? {
    val look = settings.lookIn.ifEmpty { defaultLookIn(ctx) }
    val i = Intent().setComponent(ComponentName(DEPUTY, DEPUTY_ACTIVITY)).putExtra("suggestionId", id).putExtra("lookIn", look.toTypedArray())
    // An app that took Deputy's package name first, or a lookalike signed with another key, is "not installed": never started, never an implicit fallback.
    if (!AppLinkTarget.trustedActivity(ctx, i)) return "Deputy isn't installed."
    return start(ctx, i, "Deputy isn't installed.")
  }

  /** The apps the phone already uses for contacts, maps, calendar and photos. */
  private fun defaultLookIn(ctx: Context): Set<String> = APP_CATEGORIES.mapNotNull { c ->
    ctx.packageManager.resolveActivity(Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, c), 0)?.activityInfo?.packageName
  }.filter { it != "android" }.toSet()   // "android" is the chooser when no default is set

  /** The silent card a bill reminder shows when it fires; a tap opens the biller (or Inflow). */
  fun remindNow(ctx: Context, id: Long, title: String, pkg: String?) {
    if (!ReportNotifier.allowed(ctx)) return
    val manager = NotificationManagerCompat.from(ctx)
    manager.createNotificationChannel(NotificationChannel(CHANNEL, "Suggestions", NotificationManager.IMPORTANCE_LOW))
    val launch = pkg?.let { ctx.packageManager.getLaunchIntentForPackage(it) } ?: ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
    val public = NotificationCompat.Builder(ctx, CHANNEL).setSmallIcon(R.drawable.inflow_report).setContentTitle("Inflow has a suggestion").build()
    val b = NotificationCompat.Builder(ctx, CHANNEL).setSmallIcon(R.drawable.inflow_report).setContentTitle(title)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPublicVersion(public).setAutoCancel(true)
    launch?.let { b.setContentIntent(PendingIntent.getActivity(ctx, CONTENT_CODE_BASE + id.toInt(), it, FLAGS)) }
    manager.notify(TAG_REMINDER, id.toInt(), b.build())
  }
}
