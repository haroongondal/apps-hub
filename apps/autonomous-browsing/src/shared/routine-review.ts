import type { ActionStep, RoutineDefinition, RoutineFile } from './types'

const PARAM_REF = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g
const COMMIT_WORDS = /\b(buy|order|pay|purchase|checkout|submit|confirm|place|subscribe|send|delete|remove)\b/i

export type Destination =
  | { kind: 'literal'; origin: string; url: string }
  | { kind: 'runtime'; params: string[] }
  | { kind: 'mixed'; prefix: string; params: string[] }

export type CommitSignal = 'certain' | 'suspected'

export interface CommitFlag {
  stepIndex: number
  signal: CommitSignal
  why: string
}

export interface RoutineReview {
  name: string
  description: string | null
  stepCount: number
  destinations: Destination[]
  requiredParams: string[]
  commits: CommitFlag[]
  opaqueClicks: number
}

export function reviewRoutineFile(file: RoutineFile): RoutineReview {
  const steps = file.definition.steps
  return {
    name: file.name,
    description: file.description,
    stepCount: steps.length,
    destinations: steps.filter(isNavigate).map((step) => classifyUrl(step.url)),
    requiredParams: requiredParamsOf(file.definition),
    commits: steps.flatMap(commitFlag),
    opaqueClicks: steps.filter((step) => step.kind === 'click' && !mentionsCommit(step.selector)).length
  }
}

export function classifyUrl(url: string): Destination {
  const params = [...url.matchAll(PARAM_REF)].map((match) => match[1] as string)
  if (params.length === 0) return { kind: 'literal', origin: originOf(url), url }

  const prefix = url.slice(0, url.indexOf('{{'))
  if (prefix === '') return { kind: 'runtime', params }
  return { kind: 'mixed', prefix, params }
}

// isCommitting's other three tests read a live element, so only this one is decidable from a file.
function commitFlag(step: ActionStep, stepIndex: number): CommitFlag[] {
  if (step.kind === 'type' && step.submit === true) {
    return [{ stepIndex, signal: 'certain', why: 'this types and presses Enter, which submits the form' }]
  }
  const wording = [step.intent, 'selector' in step ? step.selector : null].filter(Boolean).join(' ')
  if (mentionsCommit(wording)) {
    return [{ stepIndex, signal: 'suspected', why: `its wording mentions "${matchedWord(wording)}"` }]
  }
  return []
}

function mentionsCommit(text: string | undefined): boolean {
  return text !== undefined && COMMIT_WORDS.test(text)
}

function matchedWord(text: string): string {
  return text.match(COMMIT_WORDS)?.[0] ?? ''
}

function requiredParamsOf(definition: RoutineDefinition): string[] {
  return Object.entries(definition.params ?? {})
    .filter(([, spec]) => spec.required === true)
    .map(([name]) => name)
}

function isNavigate(step: ActionStep): step is Extract<ActionStep, { kind: 'navigate' }> {
  return step.kind === 'navigate'
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

export interface Secret {
  where: 'step' | 'param' | 'description'
  stepIndex: number | null
  name: string
  value: string
}

export function findSecrets(file: RoutineFile): Secret[] {
  const found: Secret[] = []
  file.definition.steps.forEach((step, stepIndex) => {
    if (step.kind === 'type' && step.text !== '' && !isParamRef(step.text)) {
      found.push({ where: 'step', stepIndex, name: `step ${stepIndex + 1}`, value: step.text })
    }
  })
  for (const [name, spec] of Object.entries(file.definition.params ?? {})) {
    if (spec.default) found.push({ where: 'param', stepIndex: null, name, value: spec.default })
  }
  if (file.description) {
    found.push({ where: 'description', stepIndex: null, name: 'description', value: file.description })
  }
  return found
}

export function redact(file: RoutineFile, secrets: Secret[]): RoutineFile {
  const steps = [...file.definition.steps]
  const params = { ...(file.definition.params ?? {}) }
  let description = file.description

  for (const secret of secrets) {
    if (secret.where === 'description') {
      description = null
      continue
    }
    if (secret.where === 'param') {
      params[secret.name] = { ...params[secret.name], required: true, default: undefined }
      continue
    }
    const step = steps[secret.stepIndex as number]
    if (!step || step.kind !== 'type') continue
    const placeholder = paramNameFor(secret.stepIndex as number, params)
    steps[secret.stepIndex as number] = { ...step, text: `{{${placeholder}}}` }
    params[placeholder] = { required: true, description: `Value for step ${(secret.stepIndex as number) + 1}` }
  }

  return { ...file, description, definition: { ...file.definition, steps, params } }
}

function paramNameFor(stepIndex: number, taken: Record<string, unknown>): string {
  const base = `secret_${stepIndex + 1}`
  if (!(base in taken)) return base
  let n = 2
  while (`${base}_${n}` in taken) n++
  return `${base}_${n}`
}

function isParamRef(text: string): boolean {
  return /^\s*\{\{\s*[a-zA-Z0-9_-]+\s*\}\}\s*$/.test(text)
}
