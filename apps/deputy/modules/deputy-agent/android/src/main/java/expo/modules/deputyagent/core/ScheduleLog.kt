package expo.modules.deputyagent.core

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put

/** One JSONL file per schedule beside the run logs, newest last, rewritten whole on each change: at most [MAX] lines. */
class ScheduleLog(root: File, private val now: () -> Long) {
  private val dir = File(root, "schedules")

  @Synchronized
  fun started(scheduleId: String, runId: String) = change(scheduleId) { list ->
    if (list.any { it.runId == runId }) list else list + ScheduleRun(now(), Outcome.RUNNING, "", runId)
  }

  @Synchronized
  fun skipped(scheduleId: String, reason: String) = change(scheduleId) { it + ScheduleRun(now(), Outcome.SKIPPED, reason, null) }

  @Synchronized
  fun ended(scheduleId: String, runId: String, result: RunResult) = change(scheduleId) { list ->
    val end = ScheduleRun(now(), Outcome.of(result.status), result.summary.orEmpty().take(SUMMARY_MAX), runId)
    if (list.none { it.runId == runId }) list + end else list.map { if (it.runId == runId) end.copy(at = it.at) else it }
  }

  /** Newest first. A run with no end that isn't the one going on now was cut off when Deputy's process died. */
  @Synchronized
  fun list(scheduleId: String, liveRunId: String?, gatePending: Boolean): List<ScheduleRun> = read(scheduleId).map {
    when {
      it.outcome != Outcome.RUNNING -> it
      it.runId == liveRunId -> if (gatePending) it.copy(outcome = Outcome.WAITING) else it
      else -> it.copy(outcome = Outcome.FAILED, summary = CUT_OFF)
    }
  }.asReversed()

  @Synchronized
  fun delete(scheduleId: String) {
    file(scheduleId).delete()
  }

  @Synchronized
  fun clear() {
    dir.listFiles()?.forEach { it.delete() }
  }

  private fun change(scheduleId: String, edit: (List<ScheduleRun>) -> List<ScheduleRun>) {
    val cutoff = now() - KEEP_MS
    val kept = edit(read(scheduleId)).filter { it.at >= cutoff }.takeLast(MAX)
    dir.mkdirs()
    val target = file(scheduleId)
    val tmp = File(dir, target.name + ".tmp")
    tmp.writeText(kept.joinToString("") { toJson(it) + "\n" })
    tmp.renameTo(target)
  }

  private fun read(scheduleId: String): List<ScheduleRun> = file(scheduleId).takeIf { it.exists() }?.readLines().orEmpty().mapNotNull { line ->
    runCatching {
      val o = Json.parseToJsonElement(line).jsonObject
      ScheduleRun(
        o["at"]!!.jsonPrimitive.long, Outcome.valueOf(o["outcome"]!!.jsonPrimitive.content.uppercase()),
        o["summary"]!!.jsonPrimitive.content, (o["runId"] as? JsonPrimitive)?.contentOrNull,
      )
    }.getOrNull()
  }

  private fun toJson(r: ScheduleRun) = buildJsonObject {
    put("at", r.at); put("outcome", r.outcome.name.lowercase()); put("summary", r.summary); put("runId", r.runId)
  }.toString()

  private fun file(scheduleId: String) = File(dir, "${scheduleId.filter(Char::isLetterOrDigit)}.jsonl")

  companion object {
    const val MAX = 30
    const val KEEP_MS = 30 * 86_400_000L
    const val SUMMARY_MAX = 300
    const val CUT_OFF = "Deputy was closed during this task. It stopped and won't continue on its own."
  }
}
