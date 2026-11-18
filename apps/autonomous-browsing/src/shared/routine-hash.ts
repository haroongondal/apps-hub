import { createHash } from 'node:crypto'
import type { RoutineDefinition } from './types'

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (typeof value !== 'object' || value === null) return value
  const record = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) sorted[key] = sortKeys(record[key])
  return sorted
}

// Apart from routines.ts because the renderer bundles that file and node:crypto cannot resolve there.
export function definitionHash(definition: RoutineDefinition): string {
  return createHash('sha256').update(JSON.stringify(sortKeys(definition.steps))).digest('hex')
}
