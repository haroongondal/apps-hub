package expo.modules.deputyagent.core

import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/** SPEC §12: one JSONL file per run, plus a marker that turns a run cut off by process death into `interrupted` (NFR-4). */
class RunStore(root: File, private val now: () -> Long, zone: ZoneId = ZoneId.systemDefault()) {
  private val runs = File(root, "runs")
  private val active = File(root, "active")
  private val stamp = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(zone)
  private var current: File? = null

  @Synchronized
  fun start(runId: String, task: String, model: String, trigger: String) {
    runs.mkdirs()
    val file = File(runs, "${stamp(now())}-$runId.jsonl")
    current = file
    active.writeText(file.name)
    append(file, buildJsonObject { put("type", "start"); put("runId", runId); put("task", task); put("model", model); put("trigger", trigger); put("at", now()) })
  }

  @Synchronized
  fun record(e: RunEvent) {
    val file = current ?: return
    when (e) {
      is RunEvent.Step -> append(
        file,
        buildJsonObject {
          put("type", "step"); put("n", e.n); put("app", e.app); put("action", e.action)
          put("verdict", e.verdict); put("result", e.result); put("costUsd", e.costUsd)
        },
      )
      is RunEvent.GateOpened -> Unit
      is RunEvent.Finished -> {
        append(file, end(e.status, e.summary, e.costUsd))
        active.delete()
        current = null
      }
    }
  }

  /** At start-up: closes a run the process died in, without resuming it (AC-9). Returns its id. */
  @Synchronized
  fun closeInterrupted(): String? {
    if (current != null) return null
    val name = active.takeIf { it.exists() }?.readText()?.trim()
    active.delete()
    val file = name?.let { File(runs, it) }?.takeIf { it.exists() } ?: return null
    append(file, end(RunStatus.INTERRUPTED, "Deputy was closed during this task. It stopped and won't continue on its own.", lastCost(file)))
    return name.substringAfter('-').substringAfter('-').removeSuffix(".jsonl")
  }

  @Synchronized
  fun prune() {
    val cutoff = stamp(now() - 30 * DAY_MS)
    runs.listFiles { f -> f.name.endsWith(".jsonl") }.orEmpty().sortedByDescending { it.name }
      .forEachIndexed { i, f -> if (f != current && (i >= MAX_RUNS || f.name.take(cutoff.length) < cutoff)) f.delete() }
  }

  @Synchronized
  fun spentToday(): Double {
    val today = stamp(now()).take(8)
    return runs.listFiles { f -> f.name.startsWith(today) && f.name.endsWith(".jsonl") }.orEmpty().sumOf(::lastCost)
  }

  private fun stamp(ms: Long) = stamp.format(Instant.ofEpochMilli(ms))

  private fun end(status: RunStatus, summary: String?, costUsd: Double) = buildJsonObject {
    put("type", "end"); put("status", status.name.lowercase()); put("summary", summary); put("costUsd", costUsd); put("at", now())
  }

  private fun lastCost(file: File): Double = runCatching {
    val last = file.useLines { it.lastOrNull() } ?: return 0.0
    (Json.parseToJsonElement(last).jsonObject["costUsd"] as? JsonPrimitive)?.doubleOrNull
  }.getOrNull() ?: 0.0

  private fun append(file: File, line: JsonObject) = file.appendText(line.toString() + "\n")

  private companion object {
    const val MAX_RUNS = 200
    const val DAY_MS = 86_400_000L
  }
}
