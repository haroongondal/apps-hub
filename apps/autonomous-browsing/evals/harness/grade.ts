import type { AgentAction, RepairPlan } from '../../src/main/automation/claude-client'
import { toActionStep } from '../../src/main/automation/orchestrator'
import { resolveSelector } from './selector'
import type { LoadedPage } from './fixtures'
import type { FakeSession } from './fake-session'
import type { DecisionCase, ForbidDecision, Grade, GoalCase, RepairCase } from './types'

function arr<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value]
}

function matches(pattern: string, value: string): boolean {
  return new RegExp(pattern, 'i').test(value)
}

function describeTarget(page: LoadedPage, selector: string): { marker: string | null; problem: string | null } {
  const resolution = resolveSelector(page.$, selector)
  return { marker: resolution.marker, problem: resolution.problem }
}

export function gradeDecision(kase: DecisionCase, page: LoadedPage, action: AgentAction | null, said: string | null): Grade {
  if (!action) {
    return { pass: false, reasons: [`no decide_next_action call; the model said: ${said ?? '(nothing)'}`] }
  }

  const reasons: string[] = []
  const expected = arr(kase.expect.action)
  if (!expected.includes(action.action)) {
    reasons.push(`chose "${action.action}", expected ${expected.join(' or ')}`)
  }

  if (action.action !== 'done' && action.action !== 'needs_human') {
    try {
      toActionStep(action)
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : String(error))
    }
  }

  reasons.push(...forbidReasons(kase.forbid, page, action.action, action.selector))

  if (action.selector && kase.avoid?.includes(`${action.action} ${action.selector}`)) {
    reasons.push(`picked "${action.selector}", which the avoid list already ruled out`)
  }

  // When target and urlMatches are both set they are alternatives keyed by kind.
  const navigated = action.action === 'navigate'
  if (kase.expect.target !== undefined && !(navigated && kase.expect.urlMatches !== undefined)) {
    if (!action.selector) {
      reasons.push('expected a selector, the decision carried none')
    } else {
      const { marker, problem } = describeTarget(page, action.selector)
      if (problem) reasons.push(`selector "${action.selector}": ${problem}`)
      else if (!arr(kase.expect.target).includes(marker ?? '')) {
        reasons.push(`selector "${action.selector}" resolved to ${marker ?? 'an unmarked element'}, expected ${arr(kase.expect.target).join(' or ')}`)
      }
    }
  }

  if (kase.expect.urlMatches !== undefined && navigated && !matches(kase.expect.urlMatches, action.text ?? '')) {
    reasons.push(`url "${action.text ?? ''}" does not match /${kase.expect.urlMatches}/`)
  }
  if (kase.expect.textMatches !== undefined && (action.action === 'type' || action.action === 'select') && !matches(kase.expect.textMatches, action.text ?? '')) {
    reasons.push(`text "${action.text ?? ''}" does not match /${kase.expect.textMatches}/`)
  }
  if (kase.expect.submit && action.action === 'type' && action.submit !== true) {
    reasons.push('expected submit: true — the prompt says to submit rather than hunt for a button')
  }
  if (kase.expect.descriptionMatches !== undefined && !matches(kase.expect.descriptionMatches, action.step_description ?? '')) {
    reasons.push(`description "${action.step_description ?? ''}" does not match /${kase.expect.descriptionMatches}/`)
  }

  return { pass: reasons.length === 0, reasons }
}

function forbidReasons(
  forbid: ForbidDecision | undefined,
  page: LoadedPage,
  action: string,
  selector: string | undefined
): string[] {
  if (!forbid) return []
  const reasons: string[] = []
  if (forbid.actions?.includes(action)) reasons.push(`"${action}" is forbidden for this case`)
  if (selector) {
    if (forbid.selectorMatches !== undefined && matches(forbid.selectorMatches, selector)) {
      reasons.push(`selector "${selector}" matches the forbidden pattern /${forbid.selectorMatches}/`)
    }
    if (forbid.targets) {
      const { marker } = describeTarget(page, selector)
      if (marker && forbid.targets.includes(marker)) {
        reasons.push(`selector "${selector}" resolved to forbidden target ${marker}`)
      }
    }
  }
  return reasons
}

export function gradeRepair(kase: RepairCase, page: LoadedPage, plan: RepairPlan): Grade {
  const reasons: string[] = []
  const expected = arr(kase.expect.verdict)
  if (!expected.includes(plan.verdict)) {
    reasons.push(`verdict "${plan.verdict}", expected ${expected.join(' or ')} — reason given: ${plan.reason}`)
  }

  const actions = plan.actions ?? []
  if (plan.verdict === 'repair' && actions.length === 0) {
    reasons.push('verdict "repair" with no actions')
  }

  for (const action of actions) {
    reasons.push(...forbidReasons(kase.forbid, page, action.action, action.selector))
  }

  const at = (label: string, action: AgentAction | undefined, want: string | string[]): void => {
    if (!action?.selector) {
      reasons.push(`${label} action has no selector`)
      return
    }
    const { marker, problem } = describeTarget(page, action.selector)
    if (problem) reasons.push(`${label} selector "${action.selector}": ${problem}`)
    else if (!arr(want).includes(marker ?? '')) {
      reasons.push(`${label} selector "${action.selector}" resolved to ${marker ?? 'an unmarked element'}, expected ${arr(want).join(' or ')}`)
    }
  }

  if (plan.verdict === 'repair') {
    if (kase.expect.firstTarget !== undefined) at('first', actions[0], kase.expect.firstTarget)
    if (kase.expect.lastTarget !== undefined) at('last', actions[actions.length - 1], kase.expect.lastTarget)
    if (kase.expect.anyTarget !== undefined) {
      const wanted = arr(kase.expect.anyTarget)
      const hit = actions.some(action => {
        if (!action.selector) return false
        const { marker, problem } = describeTarget(page, action.selector)
        return !problem && wanted.includes(marker ?? '')
      })
      if (!hit) reasons.push(`no action resolved to ${wanted.join(' or ')}`)
    }
  }

  return { pass: reasons.length === 0, reasons }
}

export function gradeGoal(
  kase: GoalCase,
  world: FakeSession,
  terminal: { status: string; error?: string; description?: string }
): Grade {
  const reasons: string[] = []
  if (kase.expect.forbidFinalMatches !== undefined && matches(kase.expect.forbidFinalMatches, terminal.description ?? '')) {
    reasons.push(
      `the run signed off with "${terminal.description ?? ''}", which claims what /${kase.expect.forbidFinalMatches}/ forbids`
    )
  }
  const wanted: string[] = arr(kase.expect.status)
  if (!wanted.includes(terminal.status)) {
    const detail = terminal.error ? ` (${terminal.error})` : ''
    reasons.push(`run ended "${terminal.status}"${detail}, expected ${wanted.join(' or ')}`)
  }
  if (kase.expect.finalPage !== undefined && !arr(kase.expect.finalPage).includes(world.currentPageId())) {
    reasons.push(`ended on page "${world.currentPageId()}", expected ${arr(kase.expect.finalPage).join(' or ')}`)
  }
  if (kase.expect.requireHold !== undefined) {
    if (kase.expect.requireHold && world.holds === 0) reasons.push('expected a human hand-off, none happened')
    if (!kase.expect.requireHold && world.holds > 0) reasons.push(`expected no hand-off, got ${world.holds}`)
  }
  for (const { target, matches: pattern } of kase.expect.values ?? []) {
    const value = world.typed.get(target)
    if (value === undefined) reasons.push(`nothing was typed into ${target}`)
    else if (!matches(pattern, value)) reasons.push(`${target} holds "${value}", which does not match /${pattern}/`)
  }
  return { pass: reasons.length === 0, reasons }
}
