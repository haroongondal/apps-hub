package expo.modules.deputyagent.android

import android.app.KeyguardManager
import android.content.Context
import android.os.PowerManager
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import expo.modules.deputyagent.core.Begin
import expo.modules.deputyagent.core.Schedule
import expo.modules.deputyagent.core.ScheduleLog
import expo.modules.deputyagent.core.ScheduledRun
import java.io.File
import java.time.DayOfWeek
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.util.UUID

object Schedules {
  const val ID = "schedule"
  const val DUE = "dueAt"
  private const val TRIGGER = "scheduled"

  @Volatile private var log: ScheduleLog? = null

  private fun prefs(c: Context) = c.getSharedPreferences("deputy-settings", Context.MODE_PRIVATE)

  private fun log(c: Context) = log ?: ScheduleLog(File(c.applicationContext.filesDir, "deputy"), System::currentTimeMillis).also { log = it }

  private fun work(id: String) = "deputy-schedule-$id"

  fun list(c: Context): List<Schedule> = prefs(c).getString("schedules", null)?.let(Schedule::fromJson).orEmpty()

  @Synchronized
  fun save(c: Context, input: Map<String, Any?>): Map<String, String?> {
    val list = list(c)
    val id = input["id"] as? String
    val s = try {
      Schedule(
        id ?: UUID.randomUUID().toString().take(8),
        (input["name"] as? String).orEmpty().trim(),
        (input["task"] as? String).orEmpty().trim(),
        (input["hour"] as? Number)?.toInt() ?: -1,
        (input["minute"] as? Number)?.toInt() ?: -1,
        (input["days"] as? List<*>).orEmpty().mapNotNull { d -> (d as? Number)?.toInt()?.takeIf { it in 1..7 }?.let(DayOfWeek::of) }.toSet(),
        input["enabled"] as? Boolean ?: true,
        list.firstOrNull { it.id == id }?.createdAt ?: System.currentTimeMillis(),
      )
    } catch (e: IllegalArgumentException) {
      return mapOf("id" to null, "error" to e.message)
    }
    ScheduledRun.paymentRefusal(s.task)?.let { return mapOf("id" to null, "error" to it) }
    write(c, if (list.any { it.id == s.id }) list.map { if (it.id == s.id) s else it } else list + s)
    enqueue(c, s, ExistingWorkPolicy.REPLACE)
    return mapOf("id" to s.id, "error" to null)
  }

  @Synchronized
  fun delete(c: Context, id: String) {
    write(c, list(c).filter { it.id != id })
    WorkManager.getInstance(c).cancelUniqueWork(work(id))
    log(c).delete(id)
    Notifier.clearSkipped(c, id)
  }

  fun history(c: Context, id: String): List<Map<String, Any?>> = log(c).list(id, AgentRuntime.liveRunId(), AgentRuntime.pendingGate() != null).map {
    mapOf("at" to it.at.toDouble(), "outcome" to it.outcome.name.lowercase(), "summary" to it.summary, "runId" to it.runId)
  }

  fun clearHistory(c: Context) = log(c).clear()

  fun toMap(s: Schedule): Map<String, Any?> = mapOf(
    "id" to s.id, "name" to s.name, "task" to s.task, "hour" to s.hour, "minute" to s.minute, "days" to s.days.sorted().map { it.value },
    "enabled" to s.enabled, "createdAt" to s.createdAt.toDouble(),
    "nextRunAt" to s.nextRun(Instant.now(), ZoneId.systemDefault())?.toEpochMilli()?.toDouble(),
  )

  // KEEP: replacing here would drop a run that is due but not yet started (phone just switched on) without recording a skip.
  fun sync(c: Context) = list(c).forEach { enqueue(c, it, ExistingWorkPolicy.KEEP) }

  fun fire(c: Context, id: String, dueAt: Long) {
    val s = list(c).firstOrNull { it.id == id && it.enabled } ?: return
    try {
      start(c, s, dueAt)
    } finally {
      enqueue(c, s, ExistingWorkPolicy.APPEND_OR_REPLACE)
    }
  }

  fun runNow(c: Context, id: String) {
    list(c).firstOrNull { it.id == id }?.let { start(c, it, System.currentTimeMillis()) }
  }

  private fun start(c: Context, s: Schedule, dueAt: Long) {
    AgentRuntime.init(c)
    val log = log(c)
    val unlocked = !c.getSystemService(KeyguardManager::class.java).isKeyguardLocked && c.getSystemService(PowerManager::class.java).isInteractive
    val blocker = ScheduledRun.blocker(
      serviceOn = DeputyAccessibilityService.instance != null,
      keySet = KeyVault.has(c, OwnerStore.settings(c)),
      busy = AgentRuntime.active,
      unlocked = unlocked,
    )
    val begin = ScheduledRun.begin(s, dueAt, System.currentTimeMillis(), ZoneId.systemDefault(), blocker) { task, apps, untrusted ->
      AgentRuntime.start(c, task, apps, untrusted, TRIGGER) { runId, result -> if (list(c).any { it.id == s.id }) log.ended(s.id, runId, result) }
    }
    when (begin) {
      is Begin.Started -> {
        log.started(s.id, begin.runId)
        Notifier.clearSkipped(c, s.id)
      }
      is Begin.Failed -> {
        log.skipped(s.id, begin.message)
        Notifier.skipped(c, s.id, s.name, begin.message)
      }
    }
  }

  private fun enqueue(c: Context, s: Schedule, policy: ExistingWorkPolicy) {
    val wm = WorkManager.getInstance(c)
    val now = Instant.now()
    val next = s.nextRun(now, ZoneId.systemDefault())
    if (next == null) {
      wm.cancelUniqueWork(work(s.id))
      return
    }
    val request = OneTimeWorkRequestBuilder<ScheduleWorker>()
      .setInitialDelay(Duration.between(now, next))
      .setInputData(workDataOf(ID to s.id, DUE to next.toEpochMilli()))
      .build()
    wm.enqueueUniqueWork(work(s.id), policy, request)
  }

  private fun write(c: Context, list: List<Schedule>) = prefs(c).edit().putString("schedules", Schedule.toJson(list)).apply()
}

class ScheduleWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    val id = inputData.getString(Schedules.ID) ?: return Result.success()
    // A failed worker would fail the next run queued behind it too, so a fault here still ends as success.
    runCatching { Schedules.fire(applicationContext, id, inputData.getLong(Schedules.DUE, 0L)) }
    return Result.success()
  }
}
