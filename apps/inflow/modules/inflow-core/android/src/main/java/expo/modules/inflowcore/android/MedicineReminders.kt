package expo.modules.inflowcore.android

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.text.format.DateFormat
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.inflowcore.R
import expo.modules.inflowcore.core.Dose
import expo.modules.inflowcore.core.Medicine
import expo.modules.inflowcore.core.Medicines
import expo.modules.inflowcore.core.ReminderState
import java.time.ZoneId
import java.util.Date

object MedicineReminders {
  const val CHANNEL = "medicines"
  const val EXTRA_MEDICINE = "medicineId"
  const val EXTRA_DUE = "dueAt"
  const val ACTION_TAKEN = "expo.modules.inflowcore.medicine.TAKEN"
  const val ACTION_SKIP = "expo.modules.inflowcore.medicine.SKIP"
  const val ACTION_SNOOZE = "expo.modules.inflowcore.medicine.SNOOZE"
  private const val LOG_TAG = "MedicineReminders"
  private const val CONTENT_CODE = 2_000_000   // clear of ReportNotifier's and SuggestionNotifier's request codes
  private val FLAGS = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

  fun allowed(ctx: Context): Boolean =
    ReportNotifier.allowed(ctx) && NotificationManagerCompat.from(ctx).getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE

  fun rearm(ctx: Context) {
    val app = ctx.applicationContext
    InflowListener.executor.execute { run(app) }
  }

  internal fun run(ctx: Context) {
    try {
      val store = StoreHolder.get(ctx).getOrNull() ?: return
      val meds = SqlMedicineStore(store)
      val now = System.currentTimeMillis()
      val plan = store.inTransaction { Medicines.tick(meds, now, ZoneId.systemDefault()) }
      plan.missed.forEach { cancel(ctx, it.medicineId, it.dueAt) }
      if (plan.notify.isNotEmpty()) {
        val byId = meds.medicines().associateBy { it.id }
        plan.notify.forEach { d -> byId[d.medicineId]?.let { post(ctx, it, d, plan.state, now) } }
      }
      schedule(ctx, plan.nextAlarm)
    } catch (e: Exception) {
      Log.w(LOG_TAG, "reminder run failed: ${e.javaClass.simpleName}")
    }
  }

  internal fun act(ctx: Context, action: String, medicineId: Long, dueAt: Long) {
    val store = StoreHolder.get(ctx).getOrNull() ?: return
    val meds = SqlMedicineStore(store)
    val now = System.currentTimeMillis()
    val zone = ZoneId.systemDefault()
    when (action) {
      ACTION_TAKEN, ACTION_SKIP -> {
        store.inTransaction { Medicines.markFromReminder(meds, medicineId, dueAt, if (action == ACTION_TAKEN) Medicines.TAKEN else Medicines.SKIPPED, now, zone) }
        cancel(ctx, medicineId, dueAt)
      }
      ACTION_SNOOZE -> {
        if (store.inTransaction { Medicines.snooze(meds, medicineId, dueAt, now, zone) } != null) cancel(ctx, medicineId, dueAt)
        else meds.get(medicineId)?.let { post(ctx, it, Dose(medicineId, dueAt, Medicines.windowEnd(it, dueAt, zone), Medicines.PENDING, null), meds.reminderState(), now) }
      }
    }
    run(ctx)
  }

  private fun post(ctx: Context, m: Medicine, d: Dose, state: ReminderState?, now: Long) {
    if (!ReportNotifier.allowed(ctx)) return
    val manager = NotificationManagerCompat.from(ctx)
    manager.createNotificationChannel(NotificationChannel(CHANNEL, "Medicine reminders", NotificationManager.IMPORTANCE_HIGH))
    val public = NotificationCompat.Builder(ctx, CHANNEL).setSmallIcon(R.drawable.inflow_report).setContentTitle("Medicine reminder").build()
    val b = NotificationCompat.Builder(ctx, CHANNEL)
      .setSmallIcon(R.drawable.inflow_report).setContentTitle("Take ${m.name}")
      .setContentText("${m.dose} at ${DateFormat.getTimeFormat(ctx).format(Date(d.dueAt))}")
      .setWhen(d.dueAt).setShowWhen(true).setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPublicVersion(public)
      .setOnlyAlertOnce(true).setTimeoutAfter(d.windowEnd - now)
      .addAction(0, "Taken", action(ctx, ACTION_TAKEN, d)).addAction(0, "Skip", action(ctx, ACTION_SKIP, d))
    if (Medicines.canSnooze(state, d.medicineId, d.dueAt, d.windowEnd, now)) b.addAction(0, "Snooze", action(ctx, ACTION_SNOOZE, d))
    ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.let { b.setContentIntent(PendingIntent.getActivity(ctx, CONTENT_CODE, it, FLAGS)) }
    manager.notify(tag(d.medicineId, d.dueAt), 0, b.build())
  }

  // The data URI keeps each dose's buttons distinct PendingIntents (extras do not count when Android compares them).
  private fun action(ctx: Context, action: String, d: Dose): PendingIntent =
    PendingIntent.getBroadcast(
      ctx, 0,
      Intent(ctx, MedicineActionReceiver::class.java).setAction(action).setData(Uri.parse("inflow-dose:${d.medicineId}/${d.dueAt}"))
        .putExtra(EXTRA_MEDICINE, d.medicineId).putExtra(EXTRA_DUE, d.dueAt),
      FLAGS,
    )

  private fun tag(medicineId: Long, dueAt: Long) = "medicine:$medicineId:$dueAt"

  fun cancel(ctx: Context, medicineId: Long, dueAt: Long) = NotificationManagerCompat.from(ctx).cancel(tag(medicineId, dueAt), 0)

  fun cancelAll(ctx: Context, medicineId: Long) {
    val manager = NotificationManagerCompat.from(ctx)
    manager.activeNotifications.filter { it.tag?.startsWith("medicine:$medicineId:") == true }.forEach { manager.cancel(it.tag, it.id) }
  }

  // Inexact on purpose: setAndAllowWhileIdle needs no exact-alarm permission; in Doze it may come some minutes late.
  private fun schedule(ctx: Context, at: Long?) {
    val pi = PendingIntent.getBroadcast(ctx, 0, Intent(ctx, MedicineAlarmReceiver::class.java), FLAGS)
    val alarms = ctx.getSystemService(AlarmManager::class.java)
    if (at == null) alarms.cancel(pi) else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
  }
}

class MedicineAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val app = context.applicationContext
    val pending = goAsync()
    InflowListener.executor.execute {
      try {
        MedicineReminders.run(app)
      } finally {
        pending.finish()
      }
    }
  }
}

class MedicineActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    val id = intent.getLongExtra(MedicineReminders.EXTRA_MEDICINE, -1L)
    val due = intent.getLongExtra(MedicineReminders.EXTRA_DUE, -1L)
    if (id < 0 || due < 0) return
    val app = context.applicationContext
    val pending = goAsync()
    InflowListener.executor.execute {
      try {
        MedicineReminders.act(app, action, id, due)
      } catch (e: Exception) {
        Log.w("MedicineAction", "action failed: ${e.javaClass.simpleName}")
      } finally {
        pending.finish()
      }
    }
  }
}
