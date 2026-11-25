package expo.modules.deputyagent.core

import java.time.Instant
import java.time.ZoneId

data class WaitingRow(val id: Long, val label: String, val dueAt: Long?, val state: String)

data class RunRow(val id: Long, val task: String, val state: String, val finishedAt: Long)

data class LiveGate(val runId: String, val task: String, val expiresAt: Long)

/** Rows of Deputy's link shares (apps/deputy/src/links.ts). Labels are names the owner gave, never screen text or someone else's words. */
object LinkRows {
  const val AUTHORITY = "com.haroon.deputy.applink"
  const val NEXUS_PACKAGE = "com.haroon.pdfeditor"

  val HEALTH_COLUMNS = arrayOf("app_id", "accessibility", "listener", "ai_source", "last_seen_at")
  const val HEALTH_MAX_ROWS = 1
  val WAITING_COLUMNS = arrayOf("id", "label", "due_at", "state")
  const val WAITING_MAX_ROWS = 100
  val RUNS_COLUMNS = arrayOf("id", "task", "state", "finished_at")
  const val RUNS_MAX_ROWS = 200

  const val WAITING_FOR_OK = "waiting_for_ok"
  const val SCHEDULED = "scheduled"
  const val DRAFT = "draft"
  const val UNNAMED_RUN = "A task you started"
  const val SHARED_DRAFT = "Draft from shared text"

  private val OWNER_TYPED = setOf("on_demand", "scheduled", "shared_text")

  /** "none" without a key (Deputy can't run); else what carried the last successful step, "own" before any. */
  fun health(accessibilityOn: Boolean, keySet: Boolean, recordedSource: String?, lastSeenAt: Long?): Array<Any?> =
    arrayOf("deputy", if (accessibilityOn) 1 else 0, null, if (!keySet) "none" else recordedSource?.takeIf { it == HubFirst.HUB || it == HubFirst.OWN } ?: HubFirst.OWN, lastSeenAt)

  fun waiting(gate: LiveGate?, schedules: List<Schedule>, tasks: List<SavedTask>, drafts: List<Draft>, now: Instant, zone: ZoneId): List<WaitingRow> {
    val gateRow = gate?.let { g ->
      val name = schedules.firstOrNull { it.task == g.task }?.name ?: tasks.firstOrNull { it.task == g.task }?.name
      WaitingRow(runNumber(g.runId) ?: 0L, name ?: UNNAMED_RUN, g.expiresAt, WAITING_FOR_OK)
    }
    val next = schedules.mapNotNull { s -> s.nextRun(now, zone)?.let { WaitingRow(s.createdAt, s.name, it.toEpochMilli(), SCHEDULED) } }.sortedBy { it.dueAt }
    val waitingDrafts = drafts.map { d -> WaitingRow(d.createdAt, d.source?.let { "Draft suggested by $it" } ?: SHARED_DRAFT, null, DRAFT) }
    return (listOfNotNull(gateRow) + next + waitingDrafts).take(WAITING_MAX_ROWS)
  }

  /** Only finished runs whose task the owner wrote: an Inflow reply run or a proposed task was worded by another app. */
  fun runs(summaries: List<RunSummary>): List<RunRow> = summaries.mapNotNull { r ->
    val id = runNumber(r.runId) ?: return@mapNotNull null
    val finished = r.endedAt ?: return@mapNotNull null
    val ownerTyped = (r.trigger ?: "on_demand") in OWNER_TYPED && !r.task.endsWith(SuggestionTask.TAIL)
    if (!ownerTyped) return@mapNotNull null
    RunRow(id, r.task, r.status, finished)
  }.take(RUNS_MAX_ROWS)

  fun runsReader(callerPackages: List<String>) = NEXUS_PACKAGE in callerPackages

  private fun runNumber(runId: String) = runId.takeIf { it.length in 1..15 }?.toLongOrNull(16)
}
