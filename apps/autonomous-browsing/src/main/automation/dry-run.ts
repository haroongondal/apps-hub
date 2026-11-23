import { classifyStep, targetSelector, wouldDo, type DryRunReport, type DryRunStep } from '../../shared/dry-run'
import { resolveStep } from '../../shared/routines'
import type { ActionStep, RoutineDefinition } from '../../shared/types'
import { AssertionFailedError, StepExecutionError, type AutomationSession } from './session'

export class DryRunBlockedError extends Error {
  constructor(what: string) {
    super(`a dry run never ${what}`)
  }
}

export function guardSession(session: AutomationSession): AutomationSession {
  return {
    connect: () => session.connect(),
    disconnect: () => session.disconnect(),
    snapshot: () => session.snapshot(),
    currentUrl: () => session.currentUrl(),
    extractText: (selector) => session.extractText(selector),
    setRunContext: (context) => session.setRunContext(context),
    setHoldReporter: (report) => session.setHoldReporter(report),
    runStep: async (step, vars) => {
      if (classifyStep(step) !== 'read-only') throw new DryRunBlockedError(`runs a "${step.kind}" step`)
      return session.runStep(step, vars)
    },
    holdForHuman: async () => {
      throw new DryRunBlockedError('asks a person to act')
    }
  }
}

interface Probe {
  found: boolean
  detail: string | null
}

async function probeTarget(session: AutomationSession, selector: string): Promise<Probe> {
  try {
    await session.runStep({ kind: 'assert', selector, expect: 'present' })
    return { found: true, detail: null }
  } catch (error) {
    const lookupFailed = error instanceof AssertionFailedError || error instanceof StepExecutionError
    if (!lookupFailed) throw error
    return { found: false, detail: error.message }
  }
}

function presenceNote(step: ActionStep, probe: Probe): string | null {
  if (step.kind !== 'assert' || step.expect !== 'absent') return probe.detail
  return probe.found ? 'It is on the page now, so this check would fail' : 'It is not on the page, so this check would pass'
}

async function captureFrame(session: AutomationSession): Promise<Pick<DryRunStep, 'frame' | 'frameNote'>> {
  const snapshot = await session.snapshot()
  return { frame: snapshot.screenshotBase64, frameNote: snapshot.screenshotError }
}

async function dryRunStep(session: AutomationSession, step: ActionStep, index: number): Promise<DryRunStep> {
  const selector = targetSelector(step)
  const probe = selector === null ? null : await probeTarget(session, selector)
  return {
    index,
    kind: step.kind,
    text: step.intent ?? `${step.kind} step`,
    wouldDo: wouldDo(step),
    skipped: classifyStep(step) !== 'read-only',
    targetFound: probe?.found ?? null,
    detail: probe ? presenceNote(step, probe) : null,
    ...(await captureFrame(session))
  }
}

export async function runDryRun(
  session: AutomationSession,
  routine: { name: string; definition: RoutineDefinition },
  vars: Record<string, string>
): Promise<DryRunReport> {
  const guarded = guardSession(session)
  const startedAt = Date.now()
  const steps: DryRunStep[] = []
  for (const [index, step] of routine.definition.steps.entries()) {
    steps.push(await dryRunStep(guarded, resolveStep(step, vars), index))
  }
  return { routineName: routine.name, startedAt, steps }
}
