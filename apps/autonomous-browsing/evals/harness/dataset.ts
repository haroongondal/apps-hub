import fs from 'node:fs'
import path from 'node:path'
import { assertRoutineDefinition } from '../../src/shared/routines'
import { loadPage, type LoadedPage } from './fixtures'
import type { Dataset, DecisionCase, FixtureRef, GoalCase, RepairCase } from './types'

const VERDICTS = ['repair', 'proceed', 'impossible']
const STATUSES = ['done', 'assisted', 'error', 'cancelled']
const RULE_KINDS = ['click', 'type', 'select', 'navigate']

export function loadDataset(evalsDir: string): Dataset {
  const pagesDir = path.join(evalsDir, 'pages')
  const errors: string[] = []
  const decisions = readSuite<DecisionCase>(evalsDir, 'decisions', errors)
  const repairs = readSuite<RepairCase>(evalsDir, 'repairs', errors)
  const goals = readSuite<GoalCase>(evalsDir, 'goals', errors)

  const seen = new Set<string>()
  for (const kase of [...decisions, ...repairs, ...goals]) {
    if (seen.has(kase.id)) errors.push(`${kase.id}: duplicate case id`)
    seen.add(kase.id)
  }

  for (const kase of decisions) validateDecision(pagesDir, kase, errors)
  for (const kase of repairs) validateRepair(pagesDir, kase, errors)
  for (const kase of goals) validateGoal(pagesDir, kase, errors)

  if (errors.length > 0) {
    throw new Error(`the eval dataset is broken:\n- ${errors.join('\n- ')}`)
  }
  return { decisions, repairs, goals }
}

function readSuite<T extends { id?: unknown }>(evalsDir: string, name: string, errors: string[]): T[] {
  const file = path.join(evalsDir, 'cases', `${name}.json`)
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    errors.push(`${name}.json: ${message(error)}`)
    return []
  }
  if (!Array.isArray(parsed)) {
    errors.push(`${name}.json: expected an array of cases`)
    return []
  }
  for (const kase of parsed) {
    if (typeof kase?.id !== 'string' || typeof kase?.note !== 'string') {
      errors.push(`${name}.json: every case needs a string id and note`)
    }
  }
  return parsed as T[]
}

function tryPage(pagesDir: string, id: string, label: string, ref: FixtureRef | undefined, errors: string[]): LoadedPage | null {
  if (!ref || typeof ref.file !== 'string' || typeof ref.url !== 'string') {
    errors.push(`${id}: ${label} needs a page with string "file" and "url"`)
    return null
  }
  try {
    return loadPage(pagesDir, ref)
  } catch (error) {
    errors.push(`${id}: ${label} (${ref.file}): ${message(error)}`)
    return null
  }
}

function markersOn(page: LoadedPage): Set<string> {
  const markers = new Set<string>()
  page.$('[data-eval-target]').each((_, el) => {
    const name = page.$(el).attr('data-eval-target')
    if (name) markers.add(name)
  })
  return markers
}

function checkMarkers(id: string, label: string, wanted: string | string[] | undefined, markers: Set<string>, errors: string[]): void {
  for (const marker of wanted === undefined ? [] : Array.isArray(wanted) ? wanted : [wanted]) {
    if (!markers.has(marker)) errors.push(`${id}: ${label} names marker "${marker}", which is on no referenced page`)
  }
}

function checkRegex(id: string, label: string, pattern: string | undefined, errors: string[]): void {
  if (pattern === undefined) return
  try {
    new RegExp(pattern, 'i')
  } catch {
    errors.push(`${id}: ${label} /${pattern}/ is not a valid regex`)
  }
}

function validateDecision(pagesDir: string, kase: DecisionCase, errors: string[]): void {
  if (typeof kase.goal !== 'string' || !kase.expect || kase.expect.action === undefined) {
    errors.push(`${kase.id}: needs goal and expect.action`)
    return
  }
  const page = tryPage(pagesDir, kase.id, 'page', kase.page, errors)
  if (!page) return
  const markers = markersOn(page)
  checkMarkers(kase.id, 'expect.target', kase.expect.target, markers, errors)
  checkMarkers(kase.id, 'forbid.targets', kase.forbid?.targets, markers, errors)
  checkRegex(kase.id, 'expect.urlMatches', kase.expect.urlMatches, errors)
  checkRegex(kase.id, 'expect.textMatches', kase.expect.textMatches, errors)
  checkRegex(kase.id, 'expect.descriptionMatches', kase.expect.descriptionMatches, errors)
  checkRegex(kase.id, 'forbid.selectorMatches', kase.forbid?.selectorMatches, errors)
  for (const turn of kase.prior ?? []) {
    if (typeof turn.decision?.action !== 'string' || typeof turn.decision?.step_description !== 'string' || typeof turn.outcome !== 'string') {
      errors.push(`${kase.id}: every prior turn needs a decision (action, step_description) and an outcome`)
    }
  }
}

function validateRepair(pagesDir: string, kase: RepairCase, errors: string[]): void {
  if (typeof kase.goal !== 'string' || typeof kase.problem !== 'string' || !kase.expect) {
    errors.push(`${kase.id}: needs goal, problem and expect`)
    return
  }
  try {
    assertRoutineDefinition({ steps: kase.steps })
  } catch (error) {
    errors.push(`${kase.id}: steps: ${message(error)}`)
  }
  if (!Number.isInteger(kase.failingIndex) || kase.failingIndex < 0 || kase.failingIndex >= (kase.steps?.length ?? 0)) {
    errors.push(`${kase.id}: failingIndex must point into steps`)
  }
  const verdicts = Array.isArray(kase.expect.verdict) ? kase.expect.verdict : [kase.expect.verdict]
  for (const verdict of verdicts) {
    if (!VERDICTS.includes(verdict)) errors.push(`${kase.id}: unknown verdict "${verdict}"`)
  }
  const page = tryPage(pagesDir, kase.id, 'page', kase.page, errors)
  if (!page) return
  const markers = markersOn(page)
  checkMarkers(kase.id, 'expect.firstTarget', kase.expect.firstTarget, markers, errors)
  checkMarkers(kase.id, 'expect.lastTarget', kase.expect.lastTarget, markers, errors)
  checkMarkers(kase.id, 'expect.anyTarget', kase.expect.anyTarget, markers, errors)
  checkMarkers(kase.id, 'forbid.targets', kase.forbid?.targets, markers, errors)
  checkRegex(kase.id, 'forbid.selectorMatches', kase.forbid?.selectorMatches, errors)
}

function validateGoal(pagesDir: string, kase: GoalCase, errors: string[]): void {
  if (typeof kase.goal !== 'string' || !kase.pages || !kase.expect) {
    errors.push(`${kase.id}: needs goal, pages and expect`)
    return
  }
  const pageIds = Object.keys(kase.pages)
  const everyMarker = new Set<string>()
  const markersByPage = new Map<string, Set<string>>()
  for (const id of pageIds) {
    const page = tryPage(pagesDir, kase.id, `pages.${id}`, kase.pages[id], errors)
    if (!page) continue
    const markers = markersOn(page)
    markersByPage.set(id, markers)
    for (const marker of markers) everyMarker.add(marker)
  }

  if (!pageIds.includes(kase.start)) errors.push(`${kase.id}: start "${kase.start}" is not in pages`)
  if (!Number.isInteger(kase.stepCap) || kase.stepCap < 1 || kase.stepCap > 20) {
    errors.push(`${kase.id}: stepCap must be an integer between 1 and 20 — every look costs a model call`)
  }
  if (kase.onHold && !pageIds.includes(kase.onHold.goto)) {
    errors.push(`${kase.id}: onHold.goto "${kase.onHold.goto}" is not in pages`)
  }

  for (const [index, rule] of (kase.transitions ?? []).entries()) {
    const where = `${kase.id}: transitions[${index}]`
    if (!RULE_KINDS.includes(rule.on?.kind)) {
      errors.push(`${where}: on.kind must be one of ${RULE_KINDS.join(', ')}`)
      continue
    }
    if (!pageIds.includes(rule.goto)) errors.push(`${where}: goto "${rule.goto}" is not in pages`)
    if (rule.from !== undefined && !pageIds.includes(rule.from)) {
      errors.push(`${where}: from "${rule.from}" is not in pages`)
    }
    if (rule.on.kind === 'navigate') {
      if (rule.on.urlMatches === undefined) errors.push(`${where}: a navigate rule needs urlMatches`)
      checkRegex(kase.id, `transitions[${index}].urlMatches`, rule.on.urlMatches, errors)
    } else if (rule.on.target !== undefined) {
      const scope = rule.from !== undefined ? (markersByPage.get(rule.from) ?? new Set<string>()) : everyMarker
      if (!scope.has(rule.on.target)) {
        errors.push(`${where}: target "${rule.on.target}" is not on ${rule.from ?? 'any'} page`)
      }
    }
    checkRegex(kase.id, `transitions[${index}].textMatches`, rule.on.textMatches, errors)
    for (const [marker, pattern] of Object.entries(rule.on.filled ?? {})) {
      if (!everyMarker.has(marker)) errors.push(`${where}: filled marker "${marker}" is on no page`)
      checkRegex(kase.id, `transitions[${index}].filled.${marker}`, pattern, errors)
    }
  }

  const statuses = Array.isArray(kase.expect.status) ? kase.expect.status : [kase.expect.status]
  for (const status of statuses) {
    if (!STATUSES.includes(status)) {
      errors.push(`${kase.id}: expect.status "${status}" must be one of ${STATUSES.join(', ')}`)
    }
  }
  const finals = kase.expect.finalPage === undefined ? [] : Array.isArray(kase.expect.finalPage) ? kase.expect.finalPage : [kase.expect.finalPage]
  for (const final of finals) {
    if (!pageIds.includes(final) && final !== 'nowhere') {
      errors.push(`${kase.id}: expect.finalPage "${final}" is not in pages`)
    }
  }
  for (const value of kase.expect.values ?? []) {
    if (!everyMarker.has(value.target)) errors.push(`${kase.id}: expect.values names marker "${value.target}", which is on no page`)
    checkRegex(kase.id, `expect.values.${value.target}`, value.matches, errors)
  }
  checkRegex(kase.id, 'expect.forbidFinalMatches', kase.expect.forbidFinalMatches, errors)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
