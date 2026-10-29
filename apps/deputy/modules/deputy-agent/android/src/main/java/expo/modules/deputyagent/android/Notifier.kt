package expo.modules.deputyagent.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import expo.modules.deputyagent.core.Gate
import expo.modules.deputyagent.core.GateKind

object Notifier {
  private const val APPROVALS = "deputy-approvals"
  private const val RUN = "deputy-run"
  const val RUN_ID = 1
  private const val GATE_ID = 2
  private const val DONE_ID = 3
  const val REPLY = "reply"
  // shortcut: a system icon until the brand icon is chosen (PRD Q4); then add a monochrome drawable.
  private const val ICON = android.R.drawable.stat_notify_sync

  private fun nm(c: Context) = c.getSystemService(NotificationManager::class.java)

  fun channels(c: Context) = nm(c).createNotificationChannels(
    listOf(
      NotificationChannel(APPROVALS, "Approvals", NotificationManager.IMPORTANCE_HIGH).apply { description = "Deputy asks before steps that can't be undone." },
      NotificationChannel(RUN, "Running task", NotificationManager.IMPORTANCE_LOW).apply { description = "Shows what Deputy is doing, with Stop." },
    ),
  )

  fun run(c: Context, text: String): Notification = Notification.Builder(c, RUN)
    .setSmallIcon(ICON)
    .setContentTitle("Deputy is working")
    .setContentText(text)
    .setOngoing(true)
    .setOnlyAlertOnce(true)
    .setContentIntent(openApp(c))
    .addAction(Notification.Action.Builder(null, "Stop", receiver(c, 9, Intent(GateReceiver.STOP), mutable = false)).build())
    .build()

  fun progress(c: Context, text: String) = nm(c).notify(RUN_ID, run(c, text))

  fun gate(c: Context, g: Gate) {
    val b = Notification.Builder(c, APPROVALS)
      .setSmallIcon(ICON)
      .setCategory(Notification.CATEGORY_REMINDER)
      .setVisibility(Notification.VISIBILITY_PRIVATE)
      .setPublicVersion(Notification.Builder(c, APPROVALS).setSmallIcon(ICON).setContentTitle("Deputy is waiting for you").build())
      .setContentIntent(openApp(c))
      .setTimeoutAfter((g.expiresAt - System.currentTimeMillis()).coerceAtLeast(1))
    if (g.kind == GateKind.CONFIRM) {
      val text = listOfNotNull(
        "${g.action}${g.target?.let { " \"$it\"" }.orEmpty()} in ${g.app}",
        g.draftText?.let { "Text: $it" },
        g.reason?.let { "Deputy says: $it" },
      ).joinToString("\n")
      b.setContentTitle("Deputy needs your OK").setContentText(text).setStyle(Notification.BigTextStyle().bigText(text))
        .addAction(Notification.Action.Builder(null, "Approve", answer(c, 0, g.id, approve = true)).setAuthenticationRequired(true).build())
        .addAction(Notification.Action.Builder(null, "Deny", answer(c, 1, g.id, approve = false)).build())
    } else {
      b.setContentTitle("Deputy has a question").setContentText(g.action).setStyle(Notification.BigTextStyle().bigText(g.action))
      g.options.take(2).forEachIndexed { i, o -> b.addAction(Notification.Action.Builder(null, o, answer(c, 3 + i, g.id, approve = false, text = o)).build()) }
      val input = RemoteInput.Builder(REPLY).setLabel("Your answer").build()
      b.addAction(Notification.Action.Builder(null, "Answer", answer(c, 2, g.id, approve = false, mutable = true)).addRemoteInput(input).build())
    }
    nm(c).notify(GATE_ID, b.build())
  }

  fun clearGate(c: Context) = nm(c).cancel(GATE_ID)

  fun finished(c: Context, summary: String) {
    nm(c).cancel(RUN_ID)
    nm(c).notify(
      DONE_ID,
      Notification.Builder(c, RUN).setSmallIcon(ICON).setContentTitle("Deputy finished").setContentText(summary)
        .setStyle(Notification.BigTextStyle().bigText(summary)).setContentIntent(openApp(c)).setAutoCancel(true).build(),
    )
  }

  private fun answer(c: Context, code: Int, gateId: String, approve: Boolean, text: String? = null, mutable: Boolean = false) =
    receiver(c, code, Intent(GateReceiver.ANSWER).setIdentifier("$gateId/$code").putExtra("gate", gateId).putExtra("approve", approve).putExtra("text", text), mutable)

  private fun receiver(c: Context, code: Int, intent: Intent, mutable: Boolean): PendingIntent = PendingIntent.getBroadcast(
    c,
    code,
    intent.setClass(c, GateReceiver::class.java),
    PendingIntent.FLAG_UPDATE_CURRENT or if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE,
  )

  private fun openApp(c: Context): PendingIntent? = c.packageManager.getLaunchIntentForPackage(c.packageName)
    ?.let { PendingIntent.getActivity(c, 0, it, PendingIntent.FLAG_IMMUTABLE) }
}

/** Not exported, so only Deputy's notification actions reach it (and apps with notification access, SPEC §8.4); each gate id resolves once. */
class GateReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      STOP -> AgentRuntime.stop()
      ANSWER -> {
        val gate = intent.getStringExtra("gate") ?: return
        val reply = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(Notifier.REPLY)?.toString()
        AgentRuntime.resolveGate(context, gate, intent.getBooleanExtra("approve", false), reply ?: intent.getStringExtra("text"))
      }
    }
  }

  companion object {
    const val STOP = "expo.modules.deputyagent.STOP"
    const val ANSWER = "expo.modules.deputyagent.ANSWER"
  }
}

class RunService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForeground(Notifier.RUN_ID, Notifier.run(this, "Starting"), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    return START_NOT_STICKY
  }
}
