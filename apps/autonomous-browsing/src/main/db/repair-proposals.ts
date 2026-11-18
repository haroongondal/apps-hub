import type Database from 'better-sqlite3'
import type { ActionStep, RepairDecision, RepairProposal, StepRepair } from '../../shared/types'

interface ProposalRow {
  id: number
  routine_id: string
  run_id: string | null
  step_index: number
  reason: string
  original: string
  replacement: string
  screenshot_path: string | null
  created_at: number
  decision: string | null
  decided_at: number | null
}

export class RepairProposalStore {
  private readonly upsertStmt
  private readonly listStmt
  private readonly byRoutineStmt
  private readonly getStmt
  private readonly decideStmt

  constructor(private readonly db: Database.Database) {
    this.upsertStmt = db.prepare(
      `INSERT INTO repair_proposals
         (routine_id, run_id, step_index, reason, original, replacement, screenshot_path, created_at)
       VALUES (@routine_id, @run_id, @step_index, @reason, @original, @replacement, @screenshot_path, @created_at)
       ON CONFLICT (routine_id, step_index) WHERE decision IS NULL DO UPDATE SET
         run_id = excluded.run_id,
         reason = excluded.reason,
         original = excluded.original,
         replacement = excluded.replacement,
         screenshot_path = excluded.screenshot_path,
         created_at = excluded.created_at`
    )
    this.listStmt = db.prepare(
      'SELECT * FROM repair_proposals WHERE decision IS NULL ORDER BY created_at DESC'
    )
    this.byRoutineStmt = db.prepare(
      'SELECT * FROM repair_proposals WHERE routine_id = ? AND decision IS NULL ORDER BY created_at DESC'
    )
    this.getStmt = db.prepare('SELECT * FROM repair_proposals WHERE id = ? AND decision IS NULL')
    this.decideStmt = db.prepare(
      'UPDATE repair_proposals SET decision = ?, decided_at = ? WHERE id = ? AND decision IS NULL'
    )
  }

  propose(routineId: string, runId: string, repair: StepRepair, screenshotPath: string | null): void {
    this.upsertStmt.run({
      routine_id: routineId,
      run_id: runId,
      step_index: repair.stepIndex,
      reason: repair.reason,
      original: JSON.stringify(repair.original),
      replacement: JSON.stringify(repair.replacement),
      screenshot_path: screenshotPath,
      created_at: Date.now()
    })
  }

  list(routineId?: string): RepairProposal[] {
    const rows = routineId ? this.byRoutineStmt.all(routineId) : this.listStmt.all()
    return (rows as ProposalRow[]).map(toModel)
  }

  get(id: number): RepairProposal | undefined {
    const row = this.getStmt.get(id) as ProposalRow | undefined
    return row ? toModel(row) : undefined
  }

  decide(id: number, decision: RepairDecision): boolean {
    return this.decideStmt.run(decision, Date.now(), id).changes > 0
  }
}

export function asStepRepair(proposal: RepairProposal): StepRepair {
  return {
    stepIndex: proposal.stepIndex,
    reason: proposal.reason,
    original: proposal.original,
    replacement: proposal.replacement
  }
}

function toModel(row: ProposalRow): RepairProposal {
  return {
    id: row.id,
    routineId: row.routine_id,
    runId: row.run_id,
    stepIndex: row.step_index,
    reason: row.reason,
    original: JSON.parse(row.original) as ActionStep,
    replacement: JSON.parse(row.replacement) as ActionStep[],
    screenshotPath: row.screenshot_path,
    createdAt: row.created_at
  }
}
