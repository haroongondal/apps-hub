import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { assertRoutineDefinition } from '../../shared/routines'
import type { RoutineDefinition, RoutineRevision, UserRoutine } from '../../shared/types'

export const MAX_REVISIONS_PER_ROUTINE = 50

const SAVE_KEYS = ['id', 'name', 'description', 'definition', 'source', 'overwrite']

interface UserRoutineRow {
  id: string
  name: string
  description: string | null
  definition: string
  source: string
  revision: number
  created_at: number
  updated_at: number
}

interface RevisionRow {
  revision: number
  reason: string
  decided_by: number | null
  created_at: number
}

export interface RevisionProvenance {
  reason: RoutineRevision['reason']
  decidedBy?: number
}

export class RoutineNameConflictError extends Error {
  readonly code = 'ROUTINE_NAME_CONFLICT'

  constructor(name: string) {
    super(`a user routine named "${name}" already exists (pass overwrite: true to replace it)`)
  }
}

export class UserRoutineStore {
  private readonly listStmt
  private readonly getStmt
  private readonly byNameStmt
  private readonly insertStmt
  private readonly updateStmt
  private readonly deleteStmt
  private readonly nextRevisionStmt
  private readonly addRevisionStmt
  private readonly pruneRevisionsStmt
  private readonly revisionsStmt
  private readonly revisionAtStmt

  constructor(private readonly db: Database.Database) {
    this.listStmt = db.prepare('SELECT * FROM user_routines ORDER BY updated_at DESC')
    this.getStmt = db.prepare('SELECT * FROM user_routines WHERE id = ?')
    this.byNameStmt = db.prepare('SELECT * FROM user_routines WHERE name = ?')
    this.insertStmt = db.prepare(
      `INSERT INTO user_routines (id, name, description, definition, source, revision, created_at, updated_at)
       VALUES (@id, @name, @description, @definition, @source, @revision, @created_at, @updated_at)`
    )
    this.updateStmt = db.prepare(
      `UPDATE user_routines
       SET name = @name, description = @description, definition = @definition, source = @source,
           revision = @revision, updated_at = @updated_at
       WHERE id = @id`
    )
    this.deleteStmt = db.prepare('DELETE FROM user_routines WHERE id = ?')
    this.nextRevisionStmt = db.prepare(
      'SELECT COALESCE(MAX(revision), 0) + 1 AS next FROM routine_versions WHERE routine_id = ?'
    )
    this.addRevisionStmt = db.prepare(
      `INSERT INTO routine_versions (routine_id, revision, definition, reason, decided_by, created_at)
       VALUES (@routine_id, @revision, @definition, @reason, @decided_by, @created_at)`
    )
    this.pruneRevisionsStmt = db.prepare(
      `DELETE FROM routine_versions
        WHERE routine_id = @routineId
          AND id NOT IN (
            SELECT id FROM routine_versions WHERE routine_id = @routineId
             ORDER BY revision DESC LIMIT @keep
          )
          AND id <> COALESCE((
            SELECT id FROM routine_versions WHERE routine_id = @routineId AND reason <> 'repair'
             ORDER BY revision ASC LIMIT 1
          ), -1)`
    )
    this.revisionsStmt = db.prepare(
      `SELECT revision, reason, decided_by, created_at FROM routine_versions
        WHERE routine_id = ? ORDER BY revision DESC`
    )
    this.revisionAtStmt = db.prepare(
      'SELECT definition FROM routine_versions WHERE routine_id = ? AND revision = ?'
    )
  }

  revisions(routineId: string): RoutineRevision[] {
    return (this.revisionsStmt.all(routineId) as RevisionRow[]).map((row) => ({
      revision: row.revision,
      reason: row.reason as RoutineRevision['reason'],
      decidedBy: row.decided_by,
      createdAt: row.created_at
    }))
  }

  definitionAt(routineId: string, revision: number): unknown {
    const row = this.revisionAtStmt.get(routineId, revision) as { definition: string } | undefined
    if (!row) throw new Error(`routine "${routineId}" has no revision ${revision}`)
    return JSON.parse(row.definition)
  }

  list(): UserRoutine[] {
    return (this.listStmt.all() as UserRoutineRow[]).map(toModel)
  }

  get(id: string): UserRoutine | undefined {
    const row = this.getStmt.get(id) as UserRoutineRow | undefined
    return row ? toModel(row) : undefined
  }

  getByName(name: string): UserRoutine | undefined {
    const row = this.byNameStmt.get(name) as UserRoutineRow | undefined
    return row ? toModel(row) : undefined
  }

  // Takes unknown because payloads arrive straight off the IPC boundary.
  save(input: unknown, provenance: RevisionProvenance = { reason: 'manual' }): UserRoutine {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new Error('save payload must be an object')
    }
    const extras = Object.keys(input).filter((key) => !SAVE_KEYS.includes(key))
    if (extras.length > 0) throw new Error(`save payload has unknown keys: ${extras.join(', ')}`)
    const { id, name, description, definition, source, overwrite } = input as Record<string, unknown>
    if (typeof name !== 'string' || !name.trim()) throw new Error('name is required')
    const trimmed = name.trim()
    if (trimmed.length > 120) throw new Error('name must be 120 characters or fewer')
    if (id !== undefined && typeof id !== 'string') throw new Error('id must be a string')
    if (description !== undefined && description !== null && typeof description !== 'string') {
      throw new Error('description must be a string')
    }
    if (overwrite !== undefined && typeof overwrite !== 'boolean') throw new Error('overwrite must be a boolean')
    const src = source === undefined ? 'chat' : source
    if (src !== 'chat' && src !== 'import') throw new Error('source must be "chat" or "import"')

    const record = {
      name: trimmed,
      description: typeof description === 'string' ? description : null,
      definition: JSON.stringify(assertRoutineDefinition(definition)),
      source: src,
      updated_at: Date.now()
    }

    return this.db.transaction((): UserRoutine => {
      const targetId = this.resolveTarget(id, trimmed, overwrite === true)
      const { next } = this.nextRevisionStmt.get(targetId) as { next: number }

      if (this.get(targetId)) {
        this.updateStmt.run({ ...record, id: targetId, revision: next })
      } else {
        this.insertStmt.run({ ...record, id: targetId, revision: next, created_at: record.updated_at })
      }
      this.stampRevision(targetId, record.definition, record.updated_at, next, provenance)
      return this.get(targetId)!
    })()
  }

  private resolveTarget(id: unknown, name: string, overwrite: boolean): string {
    if (id !== undefined) {
      if (!this.get(id as string)) throw new Error(`no user routine with id "${id as string}"`)
      const clash = this.getByName(name)
      if (clash && clash.id !== id) {
        if (!overwrite) throw new RoutineNameConflictError(name)
        this.deleteStmt.run(clash.id)
      }
      return id as string
    }
    const clash = this.getByName(name)
    if (clash) {
      if (!overwrite) throw new RoutineNameConflictError(name)
      return clash.id
    }
    return randomUUID()
  }

  private stampRevision(
    routineId: string,
    definition: string,
    at: number,
    revision: number,
    provenance: RevisionProvenance
  ): void {
    this.addRevisionStmt.run({
      routine_id: routineId,
      revision,
      definition,
      reason: provenance.reason,
      decided_by: provenance.decidedBy ?? null,
      created_at: at
    })
    this.pruneRevisionsStmt.run({ routineId, keep: MAX_REVISIONS_PER_ROUTINE })
  }

  remove(id: string): boolean {
    return this.deleteStmt.run(id).changes > 0
  }
}

function toModel(row: UserRoutineRow): UserRoutine {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    definition: JSON.parse(row.definition) as RoutineDefinition,
    source: row.source as UserRoutine['source'],
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
