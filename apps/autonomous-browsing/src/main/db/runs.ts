import type Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import type {
  ActionStep,
  AutomationProgressEvent,
  CapturedArtifact,
  ProgressStatus,
  PurgeResult,
  RunArtifactRecord,
  RunDetail,
  RunEventRecord,
  RoutineHealth,
  RunListQuery,
  RunRepairRecord,
  RunStatus,
  RunStepOutcome,
  RunStepRecord,
  RunSummary,
  RunUsage,
  StepRepair
} from '../../shared/types'

export const MAX_RUNS = 200
export const MAX_RUN_AGE_MS = 30 * 24 * 60 * 60 * 1000
// Below MAX_RUNS the rail could not reach every run retention had kept.
const DEFAULT_LIST_LIMIT = MAX_RUNS

const TERMINAL: ReadonlySet<ProgressStatus> = new Set(['done', 'assisted', 'error', 'cancelled'])

export interface RunOpenMeta {
  routineId: string | null
  routineKind: 'system' | 'user' | null
  routineName: string
  params: Record<string, string>
  rerunOf?: string | null
  resumedFromRunId?: string | null
  resumeStartIndex?: number | null
  definitionHash?: string | null
  routineRevision?: number | null
  resumeVars?: Record<string, string> | null
}

interface RunRow {
  id: string
  source: string
  routine_id: string | null
  routine_kind: string | null
  routine_name: string
  params: string
  status: string
  started_at: number
  ended_at: number | null
  error: string | null
  failed_step_index: number | null
  step_count: number
  human_steps: number
  opened_at: number | null
  recorded_steps: string | null
  llm_calls: number
  repair_calls: number
  repair_budget_spent: number
  input_tokens: number
  cached_input_tokens: number
  cache_write_tokens: number
  output_tokens: number
  model: string | null
  rerun_of: string | null
  resumed_from_run_id: string | null
  resume_start_index: number | null
  definition_hash: string | null
  routine_revision: number | null
  error_kind: string | null
  resume_vars: string | null
}

interface StepRow {
  step_index: number
  kind: string
  attempts: number
  resolved_by: string
  changed: number | null
  via: string | null
  recovered: number | null
  browser_ms: number
  model_ms: number
  held_ms: number
  llm_calls: number
  started_at: number
  ended_at: number | null
  static_looks: number | null
  thread_turns: number | null
  stop_reason: string | null
  page_fingerprint: string | null
  thinking: number | null
  committing: number | null
}

interface EventRow {
  seq: number
  status: string
  step_index: number
  description: string
  step_json: string | null
  error: string | null
  at: number
}

interface ArtifactRow {
  id: number
  kind: string
  step_index: number
  label: string
  text_value: string | null
  file_path: string | null
}

interface RepairRow {
  step_index: number
  reason: string
  original: string
  replacement: string
  at: number
}

export class RunStore {
  private readonly stmt
  private writes: Promise<void> = Promise.resolve()

  constructor(
    private readonly db: Database.Database,
    private readonly artifactsDir: string
  ) {
    this.stmt = {
      open: db.prepare(
        `INSERT INTO runs (id, source, routine_id, routine_kind, routine_name, params, status, started_at, step_count,
                           rerun_of, resumed_from_run_id, resume_start_index, definition_hash, routine_revision, resume_vars)
         VALUES (@id, @source, @routine_id, @routine_kind, @routine_name, @params, 'running', @started_at, @step_count,
                 @rerun_of, @resumed_from_run_id, @resume_start_index, @definition_hash, @routine_revision, @resume_vars)
         ON CONFLICT (id) DO NOTHING`
      ),
      appendEvent: db.prepare(
        `INSERT INTO run_events (run_id, seq, status, step_index, description, step_json, error, at)
         VALUES (@run_id, (SELECT COALESCE(MAX(seq), -1) + 1 FROM run_events WHERE run_id = @run_id),
                 @status, @step_index, @description, @step_json, @error, @at)`
      ),
      close: db.prepare(
        `UPDATE runs SET status = @status, ended_at = @ended_at, error = @error,
                         failed_step_index = @failed_step_index, error_kind = @error_kind,
                         human_steps = (SELECT COUNT(*) FROM run_events WHERE run_id = @id AND status = 'held')
         WHERE id = @id`
      ),
      markHeld: db.prepare(`UPDATE runs SET status = 'held' WHERE id = ? AND ended_at IS NULL`),
      markRunning: db.prepare(`UPDATE runs SET status = 'running' WHERE id = ? AND ended_at IS NULL`),
      growStepCount: db.prepare('UPDATE runs SET step_count = MAX(step_count, ?) WHERE id = ?'),
      insertArtifact: db.prepare(
        `INSERT INTO run_artifacts (run_id, step_index, kind, label, text_value, file_path)
         VALUES (@run_id, @step_index, @kind, @label, @text_value, @file_path)`
      ),
      repairShot: db.prepare(
        `SELECT file_path FROM run_artifacts
          WHERE run_id = ? AND step_index = ? AND kind = 'repair'
          ORDER BY id DESC LIMIT 1`
      ),
      insertRepair: db.prepare(
        `INSERT INTO run_repairs (run_id, step_index, reason, original, replacement, at)
         VALUES (@run_id, @step_index, @reason, @original, @replacement, @at)`
      ),
      list: db.prepare('SELECT * FROM runs ORDER BY started_at DESC, rowid DESC LIMIT ?'),
      listBySource: db.prepare(
        'SELECT * FROM runs WHERE source = ? ORDER BY started_at DESC, rowid DESC LIMIT ?'
      ),
      get: db.prepare('SELECT * FROM runs WHERE id = ?'),
      events: db.prepare('SELECT * FROM run_events WHERE run_id = ? ORDER BY seq'),
      artifacts: db.prepare('SELECT * FROM run_artifacts WHERE run_id = ? ORDER BY id'),
      repairs: db.prepare('SELECT * FROM run_repairs WHERE run_id = ? ORDER BY id'),
      // A proceed verdict spends budget with no run_repairs row behind it.
      chainBudget: db.prepare(
        `WITH RECURSIVE chain(id) AS (
           SELECT id FROM runs WHERE id = ?
           UNION
           SELECT r.resumed_from_run_id FROM runs r JOIN chain c ON r.id = c.id
            WHERE r.resumed_from_run_id IS NOT NULL
         )
         SELECT COALESCE(SUM(repair_budget_spent), 0) AS used FROM runs WHERE id IN (SELECT id FROM chain)`
      ),
      chainCommitting: db.prepare(
        `WITH RECURSIVE chain(id) AS (
           SELECT id FROM runs WHERE id = ?
           UNION
           SELECT r.resumed_from_run_id FROM runs r JOIN chain c ON r.id = c.id
            WHERE r.resumed_from_run_id IS NOT NULL
         )
         SELECT DISTINCT step_index FROM run_steps
          WHERE run_id IN (SELECT id FROM chain) AND committing = 1
          ORDER BY step_index`
      ),
      artifactPath: db.prepare('SELECT file_path FROM run_artifacts WHERE id = ?'),
      markOpened: db.prepare('UPDATE runs SET opened_at = ? WHERE id = ? AND opened_at IS NULL'),
      setRecorded: db.prepare('UPDATE runs SET recorded_steps = ? WHERE id = ?'),
      remove: db.prepare('DELETE FROM runs WHERE id = ?'),
      exists: db.prepare('SELECT 1 FROM runs WHERE id = ?'),
      openRuns: db.prepare('SELECT id FROM runs WHERE ended_at IS NULL'),
      closeInterrupted: db.prepare(
        `UPDATE runs SET status = 'interrupted', ended_at = ?, error = 'the app closed while this run was in flight'
         WHERE ended_at IS NULL`
      ),
      stepStatuses: db.prepare(
        'SELECT step_index, status FROM run_events WHERE run_id = ? AND step_index >= 0'
      ),
      health: db.prepare(
        `SELECT routine_name AS name, source,
                COUNT(*) AS runs,
                SUM(status = 'done') AS unattended,
                SUM(status = 'assisted') AS assisted,
                SUM(status = 'error') AS failed,
                AVG(CASE WHEN ended_at IS NOT NULL THEN ended_at - started_at END) AS average_ms,
                SUM(llm_calls) AS llm_calls,
                SUM(input_tokens + cached_input_tokens + cache_write_tokens + output_tokens) AS tokens
         FROM runs
         GROUP BY routine_name, source
         ORDER BY runs DESC, routine_name`
      ),
      trouble: db.prepare(
        `SELECT r.routine_name AS name, s.step_index AS step_index, COUNT(*) AS trouble
         FROM run_steps s JOIN runs r ON r.id = s.run_id
         WHERE s.resolved_by IN ('failed', 'human')
         GROUP BY r.routine_name, s.step_index
         ORDER BY trouble DESC, s.step_index`
      ),
      upsertStep: db.prepare(
        `INSERT INTO run_steps (run_id, step_index, kind, attempts, resolved_by, changed, via, recovered,
                                browser_ms, model_ms, held_ms, llm_calls, started_at, ended_at,
                                static_looks, thread_turns, stop_reason, page_fingerprint, thinking, committing)
         VALUES (@run_id, @step_index, @kind, @attempts, @resolved_by, @changed, @via, @recovered,
                 @browser_ms, @model_ms, @held_ms, @llm_calls, @started_at, @ended_at,
                 @static_looks, @thread_turns, @stop_reason, @page_fingerprint, @thinking, @committing)
         ON CONFLICT (run_id, step_index) DO UPDATE SET
           kind = excluded.kind, attempts = excluded.attempts, resolved_by = excluded.resolved_by,
           changed = excluded.changed, via = excluded.via, recovered = excluded.recovered,
           browser_ms = excluded.browser_ms, model_ms = excluded.model_ms, held_ms = excluded.held_ms,
           llm_calls = excluded.llm_calls, ended_at = excluded.ended_at,
           static_looks = excluded.static_looks, thread_turns = excluded.thread_turns,
           stop_reason = excluded.stop_reason, page_fingerprint = excluded.page_fingerprint,
           thinking = excluded.thinking, committing = excluded.committing`
      ),
      steps: db.prepare('SELECT * FROM run_steps WHERE run_id = ? ORDER BY step_index'),
      setUsage: db.prepare(
        `UPDATE runs SET llm_calls = @llm_calls, repair_calls = @repair_calls,
                         repair_budget_spent = @repair_budget_spent, input_tokens = @input_tokens,
                         cached_input_tokens = @cached_input_tokens, cache_write_tokens = @cache_write_tokens,
                         output_tokens = @output_tokens, model = @model
         WHERE id = @id`
      ),
      stale: db.prepare(
        `SELECT id FROM runs
         WHERE ended_at IS NOT NULL
           AND (started_at < ?
                OR id NOT IN (SELECT id FROM runs ORDER BY started_at DESC, rowid DESC LIMIT ?))`
      )
    }
  }

  record(event: AutomationProgressEvent, meta: RunOpenMeta): void {
    this.db.transaction(() => {
      this.stmt.open.run({
        id: event.runId,
        source: event.source,
        routine_id: meta.routineId,
        routine_kind: meta.routineKind,
        routine_name: meta.routineName,
        params: JSON.stringify(meta.params),
        started_at: Date.now(),
        step_count: event.totalSteps ?? 0,
        rerun_of: meta.rerunOf ?? null,
        resumed_from_run_id: meta.resumedFromRunId ?? null,
        resume_start_index: meta.resumeStartIndex ?? null,
        definition_hash: meta.definitionHash ?? null,
        routine_revision: meta.routineRevision ?? null,
        resume_vars: meta.resumeVars ? JSON.stringify(meta.resumeVars) : null
      })

      this.stmt.appendEvent.run({
        run_id: event.runId,
        status: event.status,
        step_index: event.stepIndex,
        description: event.description,
        step_json: event.step ? JSON.stringify(event.step) : null,
        error: event.error ?? null,
        at: Date.now()
      })

      const aboutAStep = event.stepIndex >= 0 && !TERMINAL.has(event.status)
      if (aboutAStep) this.stmt.growStepCount.run(event.stepIndex + 1, event.runId)
      // `healing` must clear a hold too, or the rail asks for a human nobody awaits.
      if (event.status === 'held') this.stmt.markHeld.run(event.runId)
      else if (!TERMINAL.has(event.status)) this.stmt.markRunning.run(event.runId)

      if (!TERMINAL.has(event.status)) return
      this.stmt.close.run({
        id: event.runId,
        status: event.status,
        ended_at: Date.now(),
        error: event.error ?? null,
        failed_step_index: event.status === 'error' && event.stepIndex >= 0 ? event.stepIndex : null,
        error_kind: event.errorKind ?? null
      })
    })()

    if (TERMINAL.has(event.status)) this.purge()
  }

  addArtifact(runId: string, artifact: CapturedArtifact): void {
    const filePath = artifact.base64 ? this.queueImage(runId, artifact) : null
    this.stmt.insertArtifact.run({
      run_id: runId,
      step_index: artifact.stepIndex,
      kind: artifact.kind,
      label: artifact.label,
      text_value: artifact.text ?? null,
      file_path: filePath
    })
  }

  repairScreenshot(runId: string, stepIndex: number): string | null {
    const row = this.stmt.repairShot.get(runId, stepIndex) as { file_path: string | null } | undefined
    return row?.file_path ?? null
  }

  setRecordedSteps(runId: string, steps: ActionStep[]): void {
    this.stmt.setRecorded.run(JSON.stringify(steps), runId)
  }

  addRepair(runId: string, repair: StepRepair): void {
    this.stmt.insertRepair.run({
      run_id: runId,
      step_index: repair.stepIndex,
      reason: repair.reason,
      original: JSON.stringify(repair.original),
      replacement: JSON.stringify(repair.replacement),
      at: Date.now()
    })
  }

  health(): RoutineHealth[] {
    const worst = new Map<string, { stepIndex: number; trouble: number }>()
    for (const row of this.stmt.trouble.all() as { name: string; step_index: number; trouble: number }[]) {
      if (!worst.has(row.name)) worst.set(row.name, { stepIndex: row.step_index, trouble: row.trouble })
    }

    const rows = this.stmt.health.all() as {
      name: string
      source: string
      runs: number
      unattended: number
      assisted: number
      failed: number
      average_ms: number | null
      llm_calls: number
      tokens: number
    }[]

    return rows.map((row) => ({
      routineName: row.name,
      source: row.source as 'routine' | 'chat',
      runs: row.runs,
      unattended: row.unattended,
      assisted: row.assisted,
      failed: row.failed,
      averageMs: row.average_ms === null ? null : Math.round(row.average_ms),
      llmCalls: row.llm_calls,
      tokens: row.tokens,
      worstStepIndex: worst.get(row.name)?.stepIndex ?? null,
      worstStepTrouble: worst.get(row.name)?.trouble ?? 0
    }))
  }

  recordStep(runId: string, record: RunStepRecord): void {
    this.stmt.upsertStep.run({
      run_id: runId,
      step_index: record.stepIndex,
      kind: record.kind,
      attempts: record.attempts,
      resolved_by: record.resolvedBy,
      changed: bit(record.changed),
      via: record.via,
      recovered: bit(record.recovered),
      browser_ms: record.browserMs,
      model_ms: record.modelMs,
      held_ms: record.heldMs,
      llm_calls: record.llmCalls,
      started_at: record.startedAt,
      ended_at: record.endedAt,
      static_looks: record.staticLooks,
      thread_turns: record.threadTurns,
      stop_reason: record.stopReason,
      page_fingerprint: record.pageFingerprint,
      thinking: bit(record.thinking),
      committing: bit(record.committing)
    })
  }

  chainRepairsUsed(runId: string): number {
    const row = this.stmt.chainBudget.get(runId) as { used: number }
    return row.used
  }

  chainCommitting(runId: string): number[] {
    const rows = this.stmt.chainCommitting.all(runId) as { step_index: number }[]
    return rows.map((row) => row.step_index)
  }

  recordUsage(runId: string, totals: RunUsage): void {
    this.stmt.setUsage.run({
      id: runId,
      llm_calls: totals.llmCalls,
      repair_calls: totals.repairCalls,
      repair_budget_spent: totals.repairBudgetSpent,
      input_tokens: totals.inputTokens,
      cached_input_tokens: totals.cachedInputTokens,
      cache_write_tokens: totals.cacheWriteTokens,
      output_tokens: totals.outputTokens,
      model: totals.model
    })
  }

  list(query: RunListQuery = {}): RunSummary[] {
    const limit = query.limit ?? DEFAULT_LIST_LIMIT
    const rows = query.source
      ? (this.stmt.listBySource.all(query.source, limit) as RunRow[])
      : (this.stmt.list.all(limit) as RunRow[])
    return rows.map((row) => this.summarise(row))
  }

  // A live run re-reads on every progress event, so only a deliberate open counts.
  get(id: string, markOpen = false): RunDetail | undefined {
    if (markOpen) this.stmt.markOpened.run(Date.now(), id)
    const row = this.stmt.get.get(id) as RunRow | undefined
    if (!row) return undefined

    return {
      ...this.summarise(row),
      params: parseJson<Record<string, string>>(row.params, {}),
      events: (this.stmt.events.all(id) as EventRow[]).map(toEvent),
      artifacts: (this.stmt.artifacts.all(id) as ArtifactRow[]).map(toArtifact),
      repairs: (this.stmt.repairs.all(id) as RepairRow[]).map(toRepair),
      steps: (this.stmt.steps.all(id) as StepRow[]).map(toStep),
      usage: toUsage(row),
      resumeVars: row.resume_vars ? parseJson<Record<string, string>>(row.resume_vars, {}) : null
    }
  }

  artifactData(artifactId: number): string | null {
    const row = this.stmt.artifactPath.get(artifactId) as { file_path: string | null } | undefined
    if (!row?.file_path) return null
    const absolute = path.join(this.artifactsDir, row.file_path)
    if (!fs.existsSync(absolute)) return null
    return `data:image/jpeg;base64,${fs.readFileSync(absolute).toString('base64')}`
  }

  remove(id: string): boolean {
    const removed = this.stmt.remove.run(id).changes > 0
    if (removed) fs.rmSync(path.join(this.artifactsDir, id), { recursive: true, force: true })
    return removed
  }

  purge(now = Date.now()): PurgeResult {
    const stale = this.stmt.stale.all(now - MAX_RUN_AGE_MS, MAX_RUNS) as { id: string }[]
    for (const { id } of stale) this.remove(id)
    return { removed: stale.length }
  }

  closeOpenRuns(): number {
    const open = (this.stmt.openRuns.all() as { id: string }[]).length
    if (open > 0) this.stmt.closeInterrupted.run(Date.now())
    return open
  }

  private summarise(row: RunRow): RunSummary {
    const statuses = this.stmt.stepStatuses.all(row.id) as { step_index: number; status: string }[]
    return { ...toSummary(row), stepOutcomes: stepOutcomes(row, statuses) }
  }

  // The existence check is what stops a run deleted mid-flight being recreated.
  private queueImage(runId: string, artifact: CapturedArtifact): string {
    const relative = path.join(runId, `${artifact.kind}-${artifact.stepIndex}-${Date.now()}.jpg`)
    const bytes = Buffer.from(artifact.base64 ?? '', 'base64')

    this.writes = this.writes
      .then(async () => {
        if (!this.stmt.exists.get(runId)) return
        await fs.promises.mkdir(path.join(this.artifactsDir, runId), { recursive: true })
        await fs.promises.writeFile(path.join(this.artifactsDir, relative), bytes)
      })
      .catch((error: unknown) => {
        console.error(`could not store a ${artifact.kind} for run ${runId}`, error)
      })

    return relative
  }

  flushWrites(): Promise<void> {
    return this.writes.then(() => undefined)
  }
}

function stepOutcomes(row: RunRow, statuses: { step_index: number; status: string }[]): RunStepOutcome[] {
  const outcomes: RunStepOutcome[] = Array.from({ length: row.step_count }, () => 'pending')
  for (const { step_index: at, status } of statuses) {
    if (at >= outcomes.length) continue
    if (status === 'healing' || status === 'held') outcomes[at] = 'attention'
    else if (outcomes[at] === 'pending') outcomes[at] = 'ran'
  }
  if (row.failed_step_index !== null && row.failed_step_index < outcomes.length) {
    outcomes[row.failed_step_index] = 'failed'
  }
  return outcomes
}

function toSummary(row: RunRow): Omit<RunSummary, 'stepOutcomes'> {
  return {
    id: row.id,
    source: row.source as RunSummary['source'],
    routineId: row.routine_id,
    routineKind: row.routine_kind as RunSummary['routineKind'],
    routineName: row.routine_name,
    status: row.status as RunStatus,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    error: row.error,
    failedStepIndex: row.failed_step_index,
    stepCount: row.step_count,
    humanSteps: row.human_steps,
    openedAt: row.opened_at,
    recordedSteps: row.recorded_steps ? parseJson<ActionStep[]>(row.recorded_steps, []) : null,
    rerunOf: row.rerun_of,
    resumedFromRunId: row.resumed_from_run_id,
    resumeStartIndex: row.resume_start_index,
    errorKind: row.error_kind,
    definitionHash: row.definition_hash
  }
}

function toEvent(row: EventRow): RunEventRecord {
  return {
    seq: row.seq,
    status: row.status as ProgressStatus,
    stepIndex: row.step_index,
    description: row.description,
    step: row.step_json ? parseJson<ActionStep | null>(row.step_json, null) : null,
    error: row.error,
    at: row.at
  }
}

function toArtifact(row: ArtifactRow): RunArtifactRecord {
  return {
    id: row.id,
    kind: row.kind as RunArtifactRecord['kind'],
    stepIndex: row.step_index,
    label: row.label,
    text: row.text_value,
    hasImage: row.file_path !== null
  }
}

function toRepair(row: RepairRow): RunRepairRecord {
  return {
    stepIndex: row.step_index,
    reason: row.reason,
    original: parseJson<ActionStep>(row.original, { kind: 'screenshot' }),
    replacement: parseJson<ActionStep[]>(row.replacement, []),
    at: row.at
  }
}

// An older build's JSON may no longer parse; a thread with a gap beats one that will not open.
function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function toStep(row: StepRow): RunStepRecord {
  return {
    stepIndex: row.step_index,
    kind: row.kind as RunStepRecord['kind'],
    attempts: row.attempts,
    resolvedBy: row.resolved_by as RunStepRecord['resolvedBy'],
    changed: flag(row.changed),
    via: row.via as RunStepRecord['via'],
    recovered: flag(row.recovered),
    browserMs: row.browser_ms,
    modelMs: row.model_ms,
    heldMs: row.held_ms,
    llmCalls: row.llm_calls,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    staticLooks: row.static_looks,
    threadTurns: row.thread_turns,
    stopReason: row.stop_reason,
    pageFingerprint: row.page_fingerprint,
    thinking: flag(row.thinking),
    committing: flag(row.committing)
  }
}

function toUsage(row: RunRow): RunUsage {
  return {
    llmCalls: row.llm_calls,
    repairCalls: row.repair_calls,
    repairBudgetSpent: row.repair_budget_spent,
    inputTokens: row.input_tokens,
    cachedInputTokens: row.cached_input_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    outputTokens: row.output_tokens,
    model: row.model ?? ''
  }
}

function bit(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0
}

function flag(value: number | null): boolean | null {
  return value === null ? null : value === 1
}
