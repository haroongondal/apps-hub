import type { ActionStep } from '../../shared/types'
import { originOf, siteDigest } from '../../shared/site-memory'
import type { SiteMemoryReader } from '../../shared/site-memory'
import type { AgentAction, ClaudeAutomationClient } from './claude-client'
import type { RunMeter } from './run-meter'
import type { AutomationSession } from './session'

export interface StepContext {
  goal: string
  steps: ActionStep[]
  index: number
}

export type Repair =
  | { outcome: 'retry'; actions: AgentAction[]; reason: string; screenshotBase64: string | null }
  | { outcome: 'proceed'; reason: string }
  | { outcome: 'giveUp'; reason: string }

export class StepHealer {
  constructor(
    private readonly browser: AutomationSession,
    private readonly claude: ClaudeAutomationClient,
    private budget: number,
    private readonly meter: RunMeter,
    private readonly landmarks: SiteMemoryReader = { forOrigin: () => [] }
  ) {}

  async plan(context: StepContext, problem: string): Promise<Repair> {
    if (this.budget <= 0)
      return { outcome: 'giveUp', reason: 'the repair budget for this run — and the runs it resumed — is used up' }
    this.budget--
    this.meter.spendRepairBudget()

    // A missing API key, a rate limit and a dead socket all mean the same thing
    // here: no repair is coming, so hand the step to a human rather than die.
    let plan
    let screenshotBase64: string | null = null
    try {
      const snapshot = await this.browser.snapshot()
      screenshotBase64 = snapshot.screenshotBase64
      const origin = originOf(snapshot.url)
      const hints = origin === null ? null : siteDigest(this.landmarks.forOrigin(origin), origin) || null
      const outcome = await this.claude.repairStep(describeContext(context), problem, snapshot, hints)
      this.meter.record('repair', outcome.usage)
      plan = outcome.plan
    } catch (error) {
      return { outcome: 'giveUp', reason: `could not work out a repair: ${message(error)}` }
    }

    if (plan.verdict === 'proceed') return { outcome: 'proceed', reason: plan.reason }
    if (plan.verdict === 'repair' && plan.actions && plan.actions.length > 0) {
      return { outcome: 'retry', actions: plan.actions, reason: plan.reason, screenshotBase64 }
    }
    return { outcome: 'giveUp', reason: plan.reason }
  }
}

export function describeContext({ goal, steps, index }: StepContext): string {
  const failing = steps[index]
  const lines = steps.map((step, i) => {
    const marker = i === index ? '>>' : i < index ? 'ok' : '  '
    return `${marker} ${i + 1}. ${JSON.stringify(step)}`
  })

  const sections = [
    `What the automation is doing: ${goal}`,
    `Its steps, with the failing one marked ">>" and the ones that already succeeded marked "ok":\n${lines.join('\n')}`
  ]
  if (failing?.intent) sections.push(`What step ${index + 1} is for: ${failing.intent}`)
  return sections.join('\n\n')
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
