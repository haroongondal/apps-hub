package expo.modules.inflowcore.android

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import expo.modules.inflowcore.core.Briefing
import expo.modules.inflowcore.core.Digest
import java.time.ZoneId
import java.util.concurrent.Executors

/** One alarm for the next 08:00 or 20:00 while the switch is on; each fire posts the summary and arms the next. */
object DigestAlarm {
  private const val LOG_TAG = "DigestAlarm"
  private val FLAGS = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
  // Its own thread: the readers of other apps wait up to 2 s, which must not hold up the capture thread (and never the main thread: they return nothing there).
  internal val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "inflow-digest").apply { isDaemon = true } }

  fun rearm(ctx: Context) {
    val app = ctx.applicationContext
    executor.execute { arm(app) }
  }

  /** Switch off: the alarm is cancelled. On: the next slot after now. Inexact on purpose (setAndAllowWhileIdle needs no exact-alarm permission); in Doze it may come some minutes late. */
  internal fun arm(ctx: Context) {
    try {
      val on = Briefing.on(StoreHolder.get(ctx).getOrNull()?.meta(Digest.META))
      val pi = PendingIntent.getBroadcast(ctx, 0, Intent(ctx, DigestAlarmReceiver::class.java), FLAGS)
      val alarms = ctx.getSystemService(AlarmManager::class.java)
      if (on) alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, Digest.nextAt(System.currentTimeMillis(), ZoneId.systemDefault()), pi) else alarms.cancel(pi)
    } catch (e: Exception) {
      Log.w(LOG_TAG, "arming failed: ${e.javaClass.simpleName}")
    }
  }

  /** Runs off the main thread. Always arms the next one, even when building or posting failed. */
  internal fun fire(ctx: Context) {
    try {
      val store = StoreHolder.get(ctx).getOrNull() ?: return
      if (!Briefing.on(store.meta(Digest.META))) return
      val now = System.currentTimeMillis()
      val zone = ZoneId.systemDefault()
      val kind = Digest.kindAt(now, zone) ?: return   // fired hours late: a stale summary is not posted
      Digest.build(kind, StoreBriefingInputs(store, ctx, zone), now, zone)?.let { DigestNotifier.post(ctx, it) }
    } catch (e: Exception) {
      Log.w(LOG_TAG, "summary failed: ${e.javaClass.simpleName}")
    } finally {
      arm(ctx)
    }
  }
}

class DigestAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val app = context.applicationContext
    val pending = goAsync()
    DigestAlarm.executor.execute {
      try {
        DigestAlarm.fire(app)
      } finally {
        pending.finish()
      }
    }
  }
}

/** After a restart the alarm is gone: arm it again. Re-arms the summary only (the older reminders are not touched). */
class DigestBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
    val app = context.applicationContext
    val pending = goAsync()
    DigestAlarm.executor.execute {
      try {
        DigestAlarm.arm(app)
      } finally {
        pending.finish()
      }
    }
  }
}
