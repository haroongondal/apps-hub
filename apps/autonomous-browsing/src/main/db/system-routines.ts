import type Database from 'better-sqlite3'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { assertRoutineDefinition } from '../../shared/routines'
import type { RoutineDefinition, SyncResult, SystemRoutine } from '../../shared/types'

interface SystemRoutineRow {
  id: string
  name: string
  version: number
  description: string | null
  definition: string
  checksum: string
  source_file: string
  loaded_at: number
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i

export class SystemRoutineStore {
  private readonly listStmt
  private readonly getStmt
  private readonly clearStmt
  private readonly insertStmt
  private lastSyncResult: SyncResult | null = null

  constructor(private readonly db: Database.Database) {
    this.listStmt = db.prepare('SELECT * FROM system_routines ORDER BY name')
    this.getStmt = db.prepare('SELECT * FROM system_routines WHERE id = ?')
    this.clearStmt = db.prepare('DELETE FROM system_routines')
    this.insertStmt = db.prepare(
      `INSERT INTO system_routines (id, name, version, description, definition, checksum, source_file, loaded_at)
       VALUES (@id, @name, @version, @description, @definition, @checksum, @source_file, @loaded_at)`
    )
  }

  list(): SystemRoutine[] {
    return (this.listStmt.all() as SystemRoutineRow[]).map(toModel)
  }

  get(id: string): SystemRoutine | undefined {
    const row = this.getStmt.get(id) as SystemRoutineRow | undefined
    return row ? toModel(row) : undefined
  }

  lastSync(): SyncResult | null {
    return this.lastSyncResult
  }

  syncFromDir(dir: string): SyncResult {
    let files: string[]
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    } catch {
      this.lastSyncResult = { loaded: 0, errors: [`updates directory is not readable: ${dir}`] }
      return this.lastSyncResult
    }

    const errors: string[] = []
    const rows: SystemRoutineRow[] = []
    const seen = new Set<string>()
    const now = Date.now()

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, file), 'utf8')
        rows.push(parseRoutineFile(file, raw, seen, now))
      } catch (error) {
        errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    let inserted = 0
    this.db.transaction(() => {
      this.clearStmt.run()
      for (const row of rows) {
        try {
          this.insertStmt.run(row)
          inserted++
        } catch (error) {
          errors.push(`${row.source_file}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    })()

    this.lastSyncResult = { loaded: inserted, errors }
    return this.lastSyncResult
  }

  watch(dir: string, onSync: (result: SyncResult) => void): () => void {
    let timer: NodeJS.Timeout | undefined
    const watcher = fs.watch(dir, () => {
      clearTimeout(timer)
      timer = setTimeout(() => onSync(this.syncFromDir(dir)), 250)
    })
    watcher.on('error', () => watcher.close())
    return () => {
      clearTimeout(timer)
      watcher.close()
    }
  }
}

function parseRoutineFile(file: string, raw: string, seen: Set<string>, now: number): SystemRoutineRow {
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('routine file must contain a JSON object')
  }
  const { id, name, version, description, definition } = parsed as Record<string, unknown>
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new Error('id must match ' + ID_PATTERN)
  if (seen.has(id)) throw new Error(`duplicate routine id "${id}"`)
  if (typeof name !== 'string' || !name.trim()) throw new Error('name is required')
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    throw new Error('version must be a positive integer within safe-integer range')
  }
  if (description !== undefined && description !== null && typeof description !== 'string') {
    throw new Error('description must be a string or null')
  }
  const validated = assertRoutineDefinition(definition)
  seen.add(id)
  return {
    id,
    name: name.trim(),
    version,
    description: description ?? null,
    definition: JSON.stringify(validated),
    checksum: crypto.createHash('sha256').update(raw).digest('hex'),
    source_file: file,
    loaded_at: now
  }
}

function toModel(row: SystemRoutineRow): SystemRoutine {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    definition: JSON.parse(row.definition) as RoutineDefinition,
    checksum: row.checksum,
    sourceFile: row.source_file,
    loadedAt: row.loaded_at
  }
}
