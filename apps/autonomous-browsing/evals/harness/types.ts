import type { ActionStep } from '../../src/shared/types'
import type { AgentAction } from '../../src/main/automation/claude-client'

export type PageTransform =
  | { set: string; attr: string; value: string }
  | { remove: string }

export interface FixtureRef {
  file: string
  url: string
  title?: string
  blockedBy?: string
  domError?: string
  prepare?: PageTransform[]
  covered?: string[]
}

export interface PriorTurn {
  decision: AgentAction
  outcome: string
}

export interface ExpectDecision {
  action: string | string[]
  target?: string | string[]
  urlMatches?: string
  textMatches?: string
  submit?: boolean
  descriptionMatches?: string
}

export interface ForbidDecision {
  actions?: string[]
  targets?: string[]
  selectorMatches?: string
}

export interface DecisionCase {
  id: string
  note: string
  goal: string
  page: FixtureRef
  avoid?: string[]
  prior?: PriorTurn[]
  expect: ExpectDecision
  forbid?: ForbidDecision
}

export interface ExpectRepair {
  verdict: string | string[]
  firstTarget?: string | string[]
  lastTarget?: string | string[]
  anyTarget?: string | string[]
}

export interface RepairCase {
  id: string
  note: string
  goal: string
  steps: ActionStep[]
  failingIndex: number
  problem: string
  page: FixtureRef
  expect: ExpectRepair
  forbid?: ForbidDecision
}

export interface TransitionRule {
  on: {
    kind: 'click' | 'type' | 'select' | 'navigate'
    target?: string
    urlMatches?: string
    textMatches?: string
    submit?: boolean
    filled?: Record<string, string>
  }
  from?: string
  goto: string
}

export type GoalStatus = 'done' | 'assisted' | 'error' | 'cancelled'

export interface ExpectGoal {
  status: GoalStatus | GoalStatus[]
  finalPage?: string | string[]
  requireHold?: boolean
  values?: Array<{ target: string; matches: string }>
  forbidFinalMatches?: string
}

export interface GoalCase {
  id: string
  note: string
  goal: string
  start: string
  pages: Record<string, FixtureRef>
  transitions: TransitionRule[]
  onHold?: { goto: string }
  stepCap: number
  expect: ExpectGoal
}

export interface Dataset {
  decisions: DecisionCase[]
  repairs: RepairCase[]
  goals: GoalCase[]
}

export interface Grade {
  pass: boolean
  reasons: string[]
}

export interface TrialRecord {
  suite: 'decisions' | 'repairs' | 'goals'
  caseId: string
  trial: number
  pass: boolean
  reasons: string[]
  output: unknown
  inputTokens: number
  outputTokens: number
  modelCalls: number
}
