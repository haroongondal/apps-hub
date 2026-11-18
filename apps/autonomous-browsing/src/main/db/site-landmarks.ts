import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { SiteOriginSummary } from '../../shared/types'
import { MAX_LANDMARK_FIELD_CHARS, isActionableField, isSyntheticLabel } from '../../shared/site-memory'
import type { LandmarkKind, SiteFact, SiteLandmark } from '../../shared/site-memory'

export const MAX_LANDMARKS_PER_ORIGIN = 40
export const MAX_LANDMARK_AGE_MS = 90 * 24 * 60 * 60 * 1000
export const MAX_ORIGINS = 200

const KINDS = new Set<string>(['control', 'route', 'obstacle'])
const STEP_KINDS = new Set<string>(['click', 'type', 'select'])

interface LandmarkRow {
  id: string
  origin: string
  kind: string
  fact_key: string
  selector: string | null
  step_kind: string | null
  url: string | null
  label: string
  hits: number
  misses: number
  first_seen: number
  last_seen: number
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`)
  return value
}

function optionalText(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`${field} must be a string or null`)
  return value
}

function assertRenderable(value: string | null, field: string): void {
  if (value === null) return
  if (isActionableField(value)) return
  throw new Error(`${field} must be at most ${MAX_LANDMARK_FIELD_CHARS} characters and carry no control character`)
}

// Facts arrive from a run loop, so this is the validation boundary — the same
// contract UserRoutineStore.save keeps, and for the same reason.
function assertFact(input: unknown): SiteFact {
  if (typeof input !== 'object' || input === null) throw new Error('a site fact must be an object')
  const fact = input as Record<string, unknown>
  const kind = text(fact['kind'], 'kind')
  if (!KINDS.has(kind)) throw new Error(`unknown landmark kind: ${kind}`)
  const stepKind = optionalText(fact['stepKind'], 'stepKind')
  if (stepKind !== null && !STEP_KINDS.has(stepKind)) throw new Error(`unknown step kind: ${stepKind}`)

  const factKey = text(fact['factKey'], 'factKey')
  const selector = optionalText(fact['selector'], 'selector')
  const url = optionalText(fact['url'], 'url')
  const label = text(fact['label'], 'label')
  assertRenderable(factKey, 'factKey')
  assertRenderable(selector, 'selector')
  assertRenderable(url, 'url')
  assertRenderable(label, 'label')

  return {
    origin: text(fact['origin'], 'origin'),
    kind: kind as LandmarkKind,
    factKey,
    selector,
    stepKind: stepKind as SiteFact['stepKind'],
    url,
    label
  }
}

function toLandmark(row: LandmarkRow): SiteLandmark {
  return {
    id: row.id,
    origin: row.origin,
    kind: row.kind as LandmarkKind,
    factKey: row.fact_key,
    selector: row.selector,
    stepKind: row.step_kind as SiteLandmark['stepKind'],
    url: row.url,
    label: row.label,
    hits: row.hits,
    misses: row.misses,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen
  }
}

export class SiteMemoryStore {
  private readonly upsertStmt
  private readonly byOriginStmt
  private readonly scoreStmt
  private readonly originsStmt
  private readonly forgetStmt
  private readonly purgeStmt
  private readonly expireStmt
  private readonly trimOriginStmt
  private readonly trimOriginsStmt

  constructor(private readonly db: Database.Database) {
    this.upsertStmt = db.prepare(
      `INSERT INTO site_landmarks
         (id, origin, kind, fact_key, selector, step_kind, url, label, hits, misses, first_seen, last_seen)
       VALUES (@id, @origin, @kind, @fact_key, @selector, @step_kind, @url, @label, 1, 0, @now, @now)
       ON CONFLICT (origin, kind, fact_key) DO UPDATE SET
         hits = hits + 1,
         label = CASE WHEN @synthetic = 1 THEN label ELSE excluded.label END,
         url = coalesce(excluded.url, url),
         selector = coalesce(excluded.selector, selector),
         step_kind = coalesce(excluded.step_kind, step_kind),
         last_seen = excluded.last_seen`
    )
    this.byOriginStmt = db.prepare('SELECT * FROM site_landmarks WHERE origin = ? ORDER BY (hits - misses) DESC, last_seen DESC')
    this.scoreStmt = db.prepare(
      `UPDATE site_landmarks
          SET hits = hits + @hit,
              misses = misses + @miss,
              last_seen = CASE WHEN @hit = 1 THEN @now ELSE last_seen END
        WHERE origin = @origin AND kind = @kind AND fact_key = @fact_key`
    )
    this.originsStmt = db.prepare(
      `SELECT origin, COUNT(*) AS landmarks, MAX(last_seen) AS last_seen
         FROM site_landmarks GROUP BY origin ORDER BY last_seen DESC`
    )
    this.forgetStmt = db.prepare('DELETE FROM site_landmarks WHERE origin = ?')
    this.purgeStmt = db.prepare('DELETE FROM site_landmarks')
    this.expireStmt = db.prepare('DELETE FROM site_landmarks WHERE last_seen < ?')
    this.trimOriginStmt = db.prepare(
      `DELETE FROM site_landmarks WHERE id IN (
         SELECT id FROM site_landmarks WHERE origin = ?
          ORDER BY (hits - misses) DESC, last_seen DESC
          LIMIT -1 OFFSET ${MAX_LANDMARKS_PER_ORIGIN}
       )`
    )
    this.trimOriginsStmt = db.prepare(
      `DELETE FROM site_landmarks WHERE origin IN (
         SELECT origin FROM site_landmarks GROUP BY origin
          ORDER BY MAX(last_seen) DESC
          LIMIT -1 OFFSET ${MAX_ORIGINS}
       )`
    )
  }

  observe(input: unknown, now = Date.now()): void {
    const fact = assertFact(input)
    this.upsertStmt.run({
      id: randomUUID(),
      origin: fact.origin,
      kind: fact.kind,
      fact_key: fact.factKey,
      selector: fact.selector,
      step_kind: fact.stepKind,
      url: fact.url,
      label: fact.label,
      synthetic: isSyntheticLabel(fact.label) ? 1 : 0,
      now
    })
    this.trimOriginStmt.run(fact.origin)
  }

  forOrigin(origin: string): SiteLandmark[] {
    return (this.byOriginStmt.all(origin) as LandmarkRow[]).map(toLandmark)
  }

  origins(): SiteOriginSummary[] {
    const rows = this.originsStmt.all() as Array<{ origin: string; landmarks: number; last_seen: number }>
    return rows.map((row) => ({ origin: row.origin, landmarks: row.landmarks, lastSeen: row.last_seen }))
  }

  scoreUse(origin: string, kind: LandmarkKind, factKey: string, worked: boolean, now = Date.now()): void {
    this.scoreStmt.run({ origin, kind, fact_key: factKey, hit: worked ? 1 : 0, miss: worked ? 0 : 1, now })
  }

  forget(origin: string): number {
    return this.forgetStmt.run(origin).changes
  }

  purge(): number {
    return this.purgeStmt.run().changes
  }

  prune(now = Date.now()): void {
    this.db.transaction(() => {
      this.expireStmt.run(now - MAX_LANDMARK_AGE_MS)
      this.trimOriginsStmt.run()
    })()
  }
}
