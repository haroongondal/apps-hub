import type { ActionStep, RoutineDefinition, RoutineFile, StepRepair } from './types'

type FieldSpec = 'string' | 'string?' | 'number?' | 'boolean?'

const SHARED_FIELDS: Record<string, FieldSpec> = { intent: 'string?' }

const STEP_FIELDS: Record<string, Record<string, FieldSpec>> = {
  navigate: { ...SHARED_FIELDS, url: 'string' },
  click: { ...SHARED_FIELDS, selector: 'string' },
  type: { ...SHARED_FIELDS, selector: 'string', text: 'string', submit: 'boolean?' },
  select: { ...SHARED_FIELDS, selector: 'string', value: 'string' },
  wait: { ...SHARED_FIELDS, forSelector: 'string?', ms: 'number?' },
  scroll: { ...SHARED_FIELDS, selector: 'string?', to: 'string?' },
  screenshot: { ...SHARED_FIELDS, label: 'string?' },
  extract: { ...SHARED_FIELDS, selector: 'string', into: 'string' },
  assert: {
    ...SHARED_FIELDS,
    selector: 'string',
    expect: 'string?',
    containsText: 'string?',
    message: 'string?'
  }
}

const PARAM_FIELDS: Record<string, FieldSpec> = {
  description: 'string?',
  required: 'boolean?',
  default: 'string?'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function checkFields(value: Record<string, unknown>, fields: Record<string, FieldSpec>, at: string, skip: string[] = []): void {
  for (const [key, spec] of Object.entries(fields)) {
    const found = value[key]
    const optional = spec.endsWith('?')
    const expected = optional ? spec.slice(0, -1) : spec
    if (found === undefined) {
      if (!optional) throw new Error(`${at}.${key} is required`)
      continue
    }
    if (typeof found !== expected) throw new Error(`${at}.${key} must be a ${expected}`)
  }
  for (const key of Object.keys(value)) {
    if (!skip.includes(key) && !(key in fields)) throw new Error(`${at} has unknown key "${key}"`)
  }
}

// A run's per-step timeout is derived from the step itself, so an unbounded
// `ms` would park a run — and the socket request behind it — indefinitely.
export const MAX_WAIT_MS = 300_000

function assertStep(step: unknown, index: number): void {
  const at = `steps[${index}]`
  if (!isRecord(step) || typeof step['kind'] !== 'string') throw new Error(`${at} must be an object with a string "kind"`)
  const kind = step['kind']
  const fields = STEP_FIELDS[kind]
  if (!fields) throw new Error(`${at} has unknown kind "${kind}"`)
  checkFields(step, fields, at, ['kind'])
  if (kind === 'wait' && step['ms'] === undefined && step['forSelector'] === undefined) {
    throw new Error(`${at} needs "ms" or "forSelector"`)
  }
  if (kind === 'wait' && step['ms'] !== undefined) {
    const ms = step['ms'] as number
    if (!Number.isFinite(ms) || ms < 0 || ms > MAX_WAIT_MS) {
      throw new Error(`${at}.ms must be between 0 and ${MAX_WAIT_MS}`)
    }
  }
  if (kind === 'scroll' && step['to'] !== undefined && step['to'] !== 'top' && step['to'] !== 'bottom') {
    throw new Error(`${at}.to must be "top" or "bottom"`)
  }
  if (kind === 'assert') {
    const expected = step['expect']
    if (expected !== undefined && expected !== 'present' && expected !== 'absent') {
      throw new Error(`${at}.expect must be "present" or "absent"`)
    }
    // Silently honouring one half is how an assertion ends up never failing.
    if (expected === 'absent' && step['containsText'] !== undefined) {
      throw new Error(`${at} cannot ask for text in an element it also expects to be absent`)
    }
  }
}

export function assertRoutineDefinition(value: unknown): RoutineDefinition {
  if (!isRecord(value)) throw new Error('definition must be an object')
  const extras = Object.keys(value).filter((k) => k !== 'steps' && k !== 'params')
  if (extras.length > 0) throw new Error(`definition has unknown keys: ${extras.join(', ')}`)
  const steps = value['steps']
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('definition.steps must be a non-empty array')
  for (let i = 0; i < steps.length; i++) assertStep(steps[i], i)
  const params = value['params']
  if (params !== undefined) {
    if (!isRecord(params)) throw new Error('definition.params must be an object')
    for (const [name, param] of Object.entries(params)) {
      if (!isRecord(param)) throw new Error(`params.${name} must be an object`)
      checkFields(param, PARAM_FIELDS, `params.${name}`)
    }
  }
  return value as unknown as RoutineDefinition
}

export const ROUTINE_FILE_FORMAT_VERSION = 1

const FILE_KEYS = ['formatVersion', 'name', 'description', 'definition']

export function assertRoutineFile(value: unknown): RoutineFile {
  if (!isRecord(value)) throw new Error('a routine file must be a JSON object')
  const extras = Object.keys(value).filter((key) => !FILE_KEYS.includes(key))
  if (extras.length > 0) throw new Error(`routine file has unknown keys: ${extras.join(', ')}`)

  const formatVersion = value['formatVersion']
  if (formatVersion !== ROUTINE_FILE_FORMAT_VERSION) {
    throw new Error(
      `this file says formatVersion ${String(formatVersion)}; this app reads ${ROUTINE_FILE_FORMAT_VERSION}`
    )
  }
  const name = value['name']
  if (typeof name !== 'string' || !name.trim()) throw new Error('name is required')
  if (name.trim().length > 120) throw new Error('name must be 120 characters or fewer')
  const description = value['description']
  if (description !== undefined && description !== null && typeof description !== 'string') {
    throw new Error('description must be a string')
  }

  return {
    formatVersion: ROUTINE_FILE_FORMAT_VERSION,
    name: name.trim(),
    description: typeof description === 'string' ? description : null,
    definition: assertRoutineDefinition(value['definition'])
  }
}

export function isLikeForLike(repair: StepRepair): boolean {
  const [replacement] = repair.replacement
  if (!replacement) return false
  if (repair.replacement.length > 1) return false
  return replacement.kind === repair.original.kind
}

// A proposal names a step by index, but the routine may have been edited or
// shortened since; applying by index alone overwrites work or punches a hole.
export function isStaleRepair(repair: StepRepair, definition: RoutineDefinition): boolean {
  const current = definition.steps[repair.stepIndex]
  if (!current) return true
  return JSON.stringify(current) !== JSON.stringify(repair.original)
}

export function applyRepairs(definition: RoutineDefinition, repairs: StepRepair[]): RoutineDefinition {
  const steps = [...definition.steps]
  for (const repair of repairs) {
    const [replacement] = repair.replacement
    if (!replacement || !isLikeForLike(repair)) continue
    steps[repair.stepIndex] = replacement
  }
  return { ...definition, steps }
}

export function describeStep(step: ActionStep): string {
  switch (step.kind) {
    case 'navigate':
      return `Navigate to ${step.url}`
    case 'click':
      return `Click ${step.selector}`
    case 'type':
      return `Type into ${step.selector}`
    case 'select':
      return `Select ${step.value} in ${step.selector}`
    case 'wait':
      return step.forSelector
        ? `Wait for ${step.forSelector}`
        : `Wait ${step.ms}ms`
    case 'scroll':
      return `Scroll ${step.to ?? 'to element'}`
    case 'screenshot':
      return `Capture screenshot${step.label ? ` (${step.label})` : ''}`
    case 'extract':
      return `Extract ${step.selector} into ${step.into}`
    case 'assert':
      if (step.expect === 'absent') return `Check ${step.selector} is gone`
      if (step.containsText) return `Check ${step.selector} says "${step.containsText}"`
      return `Check ${step.selector} is there`
  }
}

export function requiredParams(definition: RoutineDefinition, params: Record<string, string>): string[] {
  const specs = Object.entries(definition.params ?? {})
  const blank = specs.filter(([name, spec]) => spec.required && !params[name]?.trim())
  return blank.map(([name]) => name)
}

export function resolveStep(step: ActionStep, vars: Record<string, string>): ActionStep {
  const fill = (value: string): string => value.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '')

  switch (step.kind) {
    case 'navigate':
      return { ...step, url: fill(step.url) }
    case 'type':
      return { ...step, text: fill(step.text) }
    case 'select':
      return { ...step, value: fill(step.value) }
    case 'assert':
      return step.containsText === undefined ? step : { ...step, containsText: fill(step.containsText) }
    default:
      return step
  }
}
