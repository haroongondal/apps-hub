package expo.modules.deputyagent.core

import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

data class RunSummary(val runId: String, val task: String, val startedAt: Long, val status: String, val summary: String?, val costUsd: Double, val steps: Int)

/** SPEC §12: one JSONL file per run, plus a marker that turns a run cut off by process death into `interrupted` (NFR-4). */
class RunStore(root: File, private val now: () -> Long, zone: ZoneId = ZoneId.systemDefault()) {
  private val runs = File(root, "runs")
  private val active = File(root, "active")
  private val spent = File(root, "spent")
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
          put("verdict", e.verdict); put("result", e.result); put("costUsd", e.costUsd); put("modelMs", e.modelMs); put("actMs", e.actMs)
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
    drop(files().sortedByDescending { it.name }.filterIndexed { i, f -> f != current && (i >= MAX_RUNS || f.name.take(cutoff.length) < cutoff) })
  }

  @Synchronized
  fun spentToday(): Double {
    val today = stamp(now()).take(8)
    return files().filter { it.name.startsWith(today) }.sumOf(::lastCost) + carried(today)
  }

  /** FR-8 history, newest first. */
  @Synchronized
  fun list(limit: Int): List<RunSummary> = files().sortedByDescending { it.name }.take(limit).mapNotNull { f ->
    runCatching {
      val lines = f.readLines().map { Json.parseToJsonElement(it).jsonObject }
      val head = lines.first()
      val end = lines.last().takeIf { it.str("type") == "end" }
      RunSummary(
        head.str("runId")!!, head.str("task")!!, (head["at"] as JsonPrimitive).longOrNull!!,
        end?.str("status") ?: if (f == current) "running" else "interrupted", end?.str("summary"), lines.last().cost(), lines.count { it.str("type") == "step" },
      )
    }.getOrNull()
  }

  @Synchronized
  fun read(runId: String): List<RunEvent> {
    val file = files().firstOrNull { it.name.endsWith("-$runId.jsonl") } ?: return emptyList()
    return file.readLines().mapNotNull { line ->
      runCatching {
        val o = Json.parseToJsonElement(line).jsonObject
        when (o.str("type")) {
          "step" -> RunEvent.Step(
            runId, o.str("n")!!.toInt(), o.str("app")!!, o.str("action")!!, o.str("verdict")!!, o.str("result")!!, o.cost(),
            o.str("modelMs")?.toLongOrNull() ?: 0, o.str("actMs")?.toLongOrNull() ?: 0,
          )
          "end" -> RunEvent.Finished(runId, RunStatus.valueOf(o.str("status")!!.uppercase()), o.str("summary"), o.cost())
          else -> null
        }
      }.getOrNull()
    }
  }

  /**
   * Route memory: the steps that ran in up to two finished runs whose task shares words with this one, as data for the
   * model to skip steps with. Old message text is left out of links, so a new message can't inherit it.
   */
  @Synchronized
  fun recall(task: String, blocked: Set<String> = emptySet()): String? {
    val want = words(task)
    val routes = files().sortedByDescending { it.name }.mapNotNull { f ->
      runCatching {
        val lines = f.readLines().map { Json.parseToJsonElement(it).jsonObject }
        val past = lines.first().str("task")!!
        val shared = (words(past) intersect want).size
        // Labels came from other apps' screens: `<` is escaped as on a screen, and apps blocked since then are left out.
        val steps = lines.filter { it.str("type") == "step" && it.str("verdict") in RAN && it.str("app") !in blocked && !failed(it.str("result").orEmpty()) }
          .map { it.str("action")!!.replace(MESSAGE, "$1…").replace("<", "&lt;") }.distinct().take(15)
        if (lines.last().str("status") != "done" || shared < 2 || shared * 2 < minOf(want.size, words(past).size) || steps.isEmpty()) null
        else Triple(shared.toDouble() / minOf(want.size, words(past).size), past.replace("<", "&lt;"), steps)
      }.getOrNull()
    }.sortedByDescending { it.first }.take(2)
    if (routes.isEmpty()) return null
    return "<memory>\nSteps that finished similar tasks before. Screens may have changed, so check each step.\n" +
      routes.joinToString("") { (_, past, steps) -> "- \"$past\": ${steps.joinToString("; ")}\n" } + "</memory>"
  }

  private fun words(s: String) = s.lowercase().split(Regex("[^\\p{L}\\p{N}]+")).filter { it.length >= 3 && it !in STOP }.toSet()

  private fun failed(result: String) = result == "waiting for the owner" || result == "declined" ||
    listOf("denied", "stale_screen", "not run").any { result.startsWith(it) }

  @Synchronized
  fun clear() = drop(files().filter { it != current })

  /** Today's spend in deleted runs is carried over first, so neither clearing nor retention resets the daily cap. */
  private fun drop(gone: List<File>) {
    if (gone.isEmpty()) return
    val today = stamp(now()).take(8)
    spent.parentFile?.mkdirs()
    spent.writeText("$today ${carried(today) + gone.filter { it.name.startsWith(today) }.sumOf(::lastCost)}")
    gone.forEach { it.delete() }
  }

  private fun files() = runs.listFiles { f -> f.name.endsWith(".jsonl") }.orEmpty().toList()

  private fun carried(today: String): Double = runCatching {
    val (day, usd) = spent.readText().trim().split(' ')
    if (day == today) usd.toDouble() else 0.0
  }.getOrDefault(0.0)

  private fun JsonObject.str(k: String) = (this[k] as? JsonPrimitive)?.contentOrNull

  private fun JsonObject.cost() = (this["costUsd"] as? JsonPrimitive)?.doubleOrNull ?: 0.0

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
    val RAN = setOf("allow", "confirm")
    val MESSAGE = Regex("([?&](?:text|body)=)[^&\\s]*")
    val STOP = setOf("the", "and", "for", "that", "this", "with", "from", "please", "tell", "what", "you", "your", "about", "then", "can")
    const val DAY_MS = 86_400_000L
  }
}
