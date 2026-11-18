import path from 'node:path'
import type Anthropic from '@anthropic-ai/sdk'
import { loadEnvFile } from '../src/main/lib/env-file'
import { ClaudeAutomationClient, type ThreadTurn } from '../src/main/automation/claude-client'
import { AutomationOrchestrator } from '../src/main/automation/orchestrator'
import { describeContext } from '../src/main/automation/step-healer'
import type { AutomationProgressEvent } from '../src/shared/types'
import { loadDataset } from './harness/dataset'
import { FakeSession } from './harness/fake-session'
import { loadPage, toSnapshot } from './harness/fixtures'
import { gradeDecision, gradeGoal, gradeRepair } from './harness/grade'
import { decisionThread } from './harness/messages'
import { formatReport, passRate, writeResults } from './harness/report'
import type { Dataset, DecisionCase, GoalCase, RepairCase, TrialRecord } from './harness/types'

interface Options {
  suite: string | null
  caseId: string | null
  trials: number
  concurrency: number
  list: boolean
  minPass: number | null
}

class CountingClient extends ClaudeAutomationClient {
  calls = 0
  inputTokens = 0
  outputTokens = 0

  override async nextAction(messages: Anthropic.MessageParam[], signal?: AbortSignal): Promise<ThreadTurn> {
    const turn = await super.nextAction(messages, signal)
    this.calls++
    this.inputTokens += turn.usage?.input_tokens ?? 0
    this.outputTokens += turn.usage?.output_tokens ?? 0
    return turn
  }
}

function parseArgs(argv: string[]): Options {
  const options: Options = { suite: null, caseId: null, trials: 3, concurrency: 4, list: false, minPass: null }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = (): string => {
      const next = argv[++i]
      if (next === undefined) throw new Error(`${flag} needs a value`)
      return next
    }
    if (flag === '--suite') options.suite = value()
    else if (flag === '--case') options.caseId = value()
    else if (flag === '--trials') options.trials = Number(value())
    else if (flag === '--concurrency') options.concurrency = Number(value())
    else if (flag === '--min-pass') options.minPass = Number(value())
    else if (flag === '--list') options.list = true
    else throw new Error(`unknown flag ${flag} — use --suite, --case, --trials, --concurrency, --min-pass, --list`)
  }
  if (!Number.isInteger(options.trials) || options.trials < 1) throw new Error('--trials must be a positive integer')
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw new Error('--concurrency must be a positive integer')
  return options
}

function select(dataset: Dataset, options: Options): Dataset {
  const wanted = <T extends { id: string }>(suite: string, cases: T[]): T[] => {
    if (options.suite !== null && options.suite !== suite) return []
    if (options.caseId !== null) return cases.filter(kase => kase.id === options.caseId)
    return cases
  }
  return {
    decisions: wanted('decisions', dataset.decisions),
    repairs: wanted('repairs', dataset.repairs),
    goals: wanted('goals', dataset.goals)
  }
}

async function runDecision(apiKey: string | undefined, pagesDir: string, kase: DecisionCase, trial: number): Promise<TrialRecord> {
  const client = new CountingClient(apiKey)
  const page = loadPage(pagesDir, kase.page)
  const thread = decisionThread(kase.goal, toSnapshot(page), kase.prior ?? [], kase.avoid ?? [])
  const turn = await client.nextAction(thread)
  const grade = gradeDecision(kase, page, turn.action, turn.text)
  return {
    suite: 'decisions',
    caseId: kase.id,
    trial,
    pass: grade.pass,
    reasons: grade.reasons,
    output: { action: turn.action, said: turn.text },
    inputTokens: client.inputTokens,
    outputTokens: client.outputTokens,
    modelCalls: 1
  }
}

async function runRepair(client: ClaudeAutomationClient, pagesDir: string, kase: RepairCase, trial: number): Promise<TrialRecord> {
  const page = loadPage(pagesDir, kase.page)
  const context = describeContext({ goal: kase.goal, steps: kase.steps, index: kase.failingIndex })
  const { plan } = await client.repairStep(context, kase.problem, toSnapshot(page))
  const grade = gradeRepair(kase, page, plan)
  return {
    suite: 'repairs',
    caseId: kase.id,
    trial,
    pass: grade.pass,
    reasons: grade.reasons,
    output: plan,
    inputTokens: 0,
    outputTokens: 0,
    modelCalls: 1
  }
}

async function runGoal(apiKey: string | undefined, pagesDir: string, kase: GoalCase, trial: number): Promise<TrialRecord> {
  const client = new CountingClient(apiKey)
  const world = new FakeSession(pagesDir, kase)
  const orchestrator = new AutomationOrchestrator(world, client)
  let terminal: { status: string; error?: string; description?: string } | null = null
  const observer = {
    progress(event: AutomationProgressEvent): void {
      if (['done', 'assisted', 'error', 'cancelled'].includes(event.status)) {
        terminal = {
          status: event.status,
          description: event.description,
          ...(event.error ? { error: event.error } : {})
        }
      }
    }
  }

  let thrown: string | null = null
  try {
    await orchestrator.runChatGoal(`eval-${kase.id}-${trial}`, kase.goal, observer)
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error)
  }
  const outcome = terminal ?? { status: 'error', ...(thrown ? { error: thrown } : {}) }
  const grade = gradeGoal(kase, world, outcome)
  return {
    suite: 'goals',
    caseId: kase.id,
    trial,
    pass: grade.pass,
    reasons: grade.reasons,
    output: { outcome, finalPage: world.currentPageId(), typed: Object.fromEntries(world.typed), holds: world.holds },
    inputTokens: client.inputTokens,
    outputTokens: client.outputTokens,
    modelCalls: client.calls
  }
}

async function pool(jobs: Array<() => Promise<TrialRecord>>, limit: number): Promise<TrialRecord[]> {
  const results: TrialRecord[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      const job = jobs[next++]!
      results.push(await job())
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker))
  return results
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const evalsDir = path.resolve('evals')
  const pagesDir = path.join(evalsDir, 'pages')
  const dataset = select(loadDataset(evalsDir), options)
  const cases = [...dataset.decisions, ...dataset.repairs, ...dataset.goals]
  if (cases.length === 0) throw new Error('no cases match — try --list to see what exists')

  if (options.list) {
    for (const suite of ['decisions', 'repairs', 'goals'] as const) {
      for (const kase of dataset[suite]) console.log(`${suite.padEnd(10)} ${kase.id.padEnd(28)} ${kase.note}`)
    }
    return
  }

  loadEnvFile(path.resolve('.env'))
  const apiKey = process.env['AI_GATEWAY_API_KEY']
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY is not set — evals call the live model through the gateway')

  const singleCalls = (dataset.decisions.length + dataset.repairs.length) * options.trials
  const goalRuns = dataset.goals.length * options.trials
  console.log(
    `${cases.length} cases × ${options.trials} trials — ${singleCalls} single calls plus ${goalRuns} goal runs (several calls each)\n`
  )

  const repairClient = new ClaudeAutomationClient(apiKey)
  const jobs: Array<() => Promise<TrialRecord>> = []
  for (let trial = 1; trial <= options.trials; trial++) {
    for (const kase of dataset.decisions) jobs.push(() => runDecision(apiKey, pagesDir, kase, trial))
    for (const kase of dataset.repairs) jobs.push(() => runRepair(repairClient, pagesDir, kase, trial))
    for (const kase of dataset.goals) jobs.push(() => runGoal(apiKey, pagesDir, kase, trial))
  }

  const guarded = jobs.map(job => async (): Promise<TrialRecord> => {
    const record = await job().catch(
      (error): TrialRecord => ({
        suite: 'decisions',
        caseId: 'harness',
        trial: 0,
        pass: false,
        reasons: [`harness error: ${error instanceof Error ? error.message : String(error)}`],
        output: null,
        inputTokens: 0,
        outputTokens: 0,
        modelCalls: 0
      })
    )
    const mark = record.pass ? '✓' : '✗'
    const detail = record.pass ? '' : ` — ${record.reasons[0] ?? ''}`
    console.log(`${mark} ${record.caseId} (trial ${record.trial})${detail}`)
    return record
  })

  const records = await pool(guarded, options.concurrency)
  console.log(formatReport(records))

  const file = writeResults(path.join(evalsDir, 'results'), {
    at: new Date().toISOString(),
    options,
    records
  })
  console.log(`\nfull transcripts: ${file}`)

  if (options.minPass !== null && passRate(records) < options.minPass) {
    console.error(`pass rate ${(passRate(records) * 100).toFixed(0)}% is below --min-pass ${options.minPass * 100}%`)
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
