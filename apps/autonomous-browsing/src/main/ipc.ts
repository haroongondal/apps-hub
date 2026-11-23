import { BrowserWindow, dialog, ipcMain, shell, type WebContents } from 'electron'
import { IpcChannels, type IpcChannel } from '../shared/ipc'
import fs from 'node:fs'
import path from 'node:path'
import {
  ROUTINE_FILE_FORMAT_VERSION,
  applyRepairs,
  assertRoutineFile,
  isLikeForLike,
  isStaleRepair,
  requiredParams
} from '../shared/routines'
import { findSecrets, reviewRoutineFile } from '../shared/routine-review'
import { definitionHash } from '../shared/routine-hash'
import { planResume } from '../shared/resume'
import type { ResumePlan, ResumeRefusal } from '../shared/resume'
import type {
  BrowserStatus,
  RoutineDefinition,
  RoutineFile,
  ChatSendInput,
  ProgressStatus,
  RepairProposal,
  ResumeDescriptor,
  RunDetail,
  RunObserver,
  RunResult,
  RunRoutineInput,
  SystemRoutine,
  UserRoutine
} from '../shared/types'
import { writeDryRunReport } from './dry-run-report'
import type { AutomationOrchestrator } from './automation/orchestrator'
import type { RunQueue } from './automation/run-queue'
import type { SessionControl } from './automation/session-control'
import type { RunOpenMeta, RunStore } from './db/runs'
import type { SystemRoutineStore } from './db/system-routines'
import { asStepRepair, type RepairProposalStore } from './db/repair-proposals'
import type { UserRoutineStore } from './db/user-routines'
import type { SiteMemoryStore } from './db/site-landmarks'

const TERMINAL: ReadonlySet<ProgressStatus> = new Set(['done', 'assisted', 'error', 'cancelled'])

// Renderer payloads are untrusted: senders are allowlisted per-window and every
// argument is validated by the store layer before it touches the database.
const trustedSenders = new WeakSet<WebContents>()

export function trustSender(sender: WebContents): void {
  trustedSenders.add(sender)
}

function handle(channel: IpcChannel, fn: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!trustedSenders.has(event.sender)) throw new Error(`rejected ${channel} from untrusted sender`)
    return fn(...args)
  })
}

export interface BrowserHost {
  openBrowser(): Promise<void>
  closeBrowser(): Promise<void>
  browserRunning(): Promise<boolean>
}

interface IpcDeps {
  system: SystemRoutineStore
  user: UserRoutineStore
  runs: RunStore
  updatesDir: string
  dryRunsDir: string
  automation: AutomationOrchestrator
  queue: RunQueue
  proposals: RepairProposalStore
  sites: SiteMemoryStore
  accept: <T>(work: () => T) => T
  control: SessionControl
  browserHost: BrowserHost | null
  broadcast: (channel: IpcChannel, payload?: unknown) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertRunRoutineInput(value: unknown): RunRoutineInput {
  if (!isRecord(value)) throw new Error('run payload must be an object')
  const { kind, id, params } = value
  if (kind !== 'system' && kind !== 'user') throw new Error('kind must be "system" or "user"')
  if (typeof id !== 'string' || !id) throw new Error('id is required')
  if (params !== undefined && !isRecord(params)) throw new Error('params must be an object')
  return { kind, id, params: params as Record<string, string> | undefined }
}

interface ResumeInput {
  runId: string
  startIndex?: number
}

interface RerunInput {
  runId: string
  params?: Record<string, string>
}

function assertResumeInput(value: unknown): ResumeInput {
  if (!isRecord(value)) throw new Error('resume payload must be an object')
  const { runId, startIndex } = value
  if (typeof runId !== 'string' || !runId) throw new Error('runId is required')
  if (startIndex === undefined) return { runId }
  if (typeof startIndex !== 'number' || !Number.isSafeInteger(startIndex) || startIndex < 0) {
    throw new Error('startIndex must be an integer of 0 or more')
  }
  return { runId, startIndex }
}

function assertRerunInput(value: unknown): RerunInput {
  if (!isRecord(value)) throw new Error('re-run payload must be an object')
  const { runId, params } = value
  if (typeof runId !== 'string' || !runId) throw new Error('runId is required')
  if (params !== undefined && !isRecord(params)) throw new Error('params must be an object')
  return { runId, params: params as Record<string, string> | undefined }
}

function assertChatSendInput(value: unknown): ChatSendInput {
  if (!isRecord(value)) throw new Error('chat payload must be an object')
  const { sessionId, goal } = value
  if (typeof sessionId !== 'string' || !sessionId) throw new Error('sessionId is required')
  if (typeof goal !== 'string' || !goal.trim()) throw new Error('goal is required')
  return { sessionId, goal: goal.trim() }
}

export function registerIpcHandlers(deps: IpcDeps): void {
  handle(IpcChannels.systemList, () => deps.system.list())
  handle(IpcChannels.systemLastSync, () => deps.system.lastSync())
  handle(IpcChannels.systemReload, () => {
    const result = deps.system.syncFromDir(deps.updatesDir)
    deps.broadcast(IpcChannels.changed, result)
    return result
  })
  handle(IpcChannels.userList, () => deps.user.list())
  handle(IpcChannels.userGet, (id) => {
    if (typeof id !== 'string') throw new Error('id must be a string')
    return deps.user.get(id) ?? null
  })
  handle(IpcChannels.userSave, (payload) => {
    const saved = deps.user.save(payload)
    deps.broadcast(IpcChannels.changed)
    return saved
  })
  handle(IpcChannels.userDelete, (id) => {
    if (typeof id !== 'string') throw new Error('id must be a string')
    const removed = deps.user.remove(id)
    if (removed) deps.broadcast(IpcChannels.changed)
    return removed
  })

  handle(IpcChannels.automationRun, (payload) => {
    const input = assertRunRoutineInput(payload)
    const { kind, id } = input
    const params = input.params ?? {}

    return deps.queue.enqueue({ kind: 'routine', target: input }, { priority: 'interactive' }, () =>
      startRoutineRun(deps, kind, id, params, {})
    )
  })

  handle(IpcChannels.automationDryRun, (payload) => {
    const input = assertRunRoutineInput(payload)
    const params = input.params ?? {}
    const { routine } = resolveRoutine(deps, input.kind, input.id)
    assertParamsFilled(routine.definition, params)

    return deps.queue.enqueue({ kind: 'routine', target: input, dryRun: true }, { priority: 'interactive' }, async () => {
      const report = await deps.automation.dryRunRoutine(routine, params)
      return writeDryRunReport(deps.dryRunsDir, report)
    })
  })

  handle(IpcChannels.automationDryRunReveal, (reportPath) => {
    if (typeof reportPath !== 'string') throw new Error('reportPath must be a string')
    const inside = path.relative(deps.dryRunsDir, path.resolve(reportPath))
    if (inside.startsWith('..') || path.isAbsolute(inside) || path.basename(inside) !== 'report.md') {
      throw new Error('that file is not a dry-run report')
    }
    shell.showItemInFolder(path.resolve(reportPath))
  })

  handle(IpcChannels.runsResumePlan, (payload) => {
    const { runId, startIndex } = assertResumeInput(payload)
    return resumePlanFor(deps, runId, startIndex).plan
  })

  handle(IpcChannels.runsResume, async (payload) => {
    const { runId, startIndex } = assertResumeInput(payload)
    const { plan, kind, id, params } = resumePlanFor(deps, runId, startIndex)
    if (!plan.ok) throw new Error(plan.message)

    const chain = { resumedFromRunId: runId, resumeStartIndex: plan.startIndex, resumeVars: plan.vars }
    const resume: ResumeDescriptor = {
      startIndex: plan.startIndex,
      vars: plan.vars,
      repairsUsed: plan.repairsUsed
    }
    const work = {
      kind: 'routine' as const,
      target: { kind, id, params },
      resume: { fromRunId: runId, startIndex: plan.startIndex }
    }

    await deps.queue.enqueue(work, { priority: 'interactive' }, () =>
      startRoutineRun(deps, kind, id, params, chain, resume)
    )
  })

  handle(IpcChannels.runsRerun, async (payload) => {
    const { runId, params: overrides } = assertRerunInput(payload)
    const { kind, id, params: original } = routineRunFor(deps, runId, 're-run')
    const params = { ...original, ...overrides }

    const { routine } = resolveRoutine(deps, kind, id)
    assertParamsFilled(routine.definition, params)

    await deps.queue.enqueue({ kind: 'routine', target: { kind, id, params } }, { priority: 'interactive' }, () =>
      startRoutineRun(deps, kind, id, params, { rerunOf: runId })
    )
  })

  handle(IpcChannels.automationChatSend, async (payload) => {
    const input = assertChatSendInput(payload)
    await deps.queue.enqueue({ kind: 'chat', input }, { priority: 'interactive' }, () => {
      const observer = runObserver(deps, {
        routineId: null,
        routineKind: null,
        routineName: input.goal,
        params: {}
      })
      return deps.automation.runChatGoal(input.sessionId, input.goal, observer)
    })
  })

  // Keyed by run rather than by chat session so a recording survives a restart:
  // the session Map does not, and the run's recorded steps are on disk.
  handle(IpcChannels.automationChatSave, (payload) => {
    if (!isRecord(payload)) throw new Error('save payload must be an object')
    const { runId, name } = payload
    if (typeof runId !== 'string' || !runId) throw new Error('runId is required')
    if (typeof name !== 'string' || !name.trim()) throw new Error('name is required')

    const run = deps.runs.get(runId)
    if (!run) throw new Error(`no run with id "${runId}"`)
    const steps = run.recordedSteps ?? []
    if (steps.length === 0) throw new Error('nothing was recorded for this run yet')

    const saved = deps.user.save({
      name: name.trim(),
      description: run.routineName,
      definition: { steps },
      source: 'chat'
    })
    deps.broadcast(IpcChannels.changed)
    return saved
  })

  handle(IpcChannels.automationStatus, () => ({
    connected: deps.control.connected,
    paused: deps.control.isPaused
  }))

  handle(IpcChannels.automationPause, (reason) => {
    deps.control.pause(typeof reason === 'string' && reason ? reason : 'paused from the app')
  })

  handle(IpcChannels.automationResume, () => {
    deps.control.resume()
  })

  // Routed through the queue so a cancel issued while paused suspends the line
  // instead of dropping the next entry into a browser the user just stopped.
  handle(IpcChannels.automationCancel, () => {
    deps.queue.cancelRunning()
  })

  handle(IpcChannels.queueList, () => deps.queue.snapshot())

  handle(IpcChannels.queueCancel, (id) => {
    if (typeof id !== 'string' || !id) throw new Error('id is required')
    return deps.queue.cancelEntry(id)
  })

  handle(IpcChannels.queueClear, () => deps.queue.clearWaiting())

  handle(IpcChannels.queueStart, () => {
    deps.queue.start()
  })

  handle(IpcChannels.browserStatus, () => browserStatus(deps))

  handle(IpcChannels.browserOpen, async () => {
    if (!deps.browserHost) throw new Error('the extension backend drives your own Chrome — nothing to open here')
    await deps.browserHost.openBrowser()
    const status = await browserStatus(deps)
    deps.broadcast(IpcChannels.browserStatus, status)
    return status
  })

  handle(IpcChannels.browserClose, async () => {
    if (!deps.browserHost) throw new Error('the extension backend drives your own Chrome — nothing to close here')
    await deps.browserHost.closeBrowser()
    const status = await browserStatus(deps)
    deps.broadcast(IpcChannels.browserStatus, status)
    return status
  })

  handle(IpcChannels.runsList, (query) => deps.runs.list(isRecord(query) ? asRunListQuery(query) : {}))

  handle(IpcChannels.runsHealth, () => deps.runs.health())

  handle(IpcChannels.runsGet, (id, markOpen) => {
    if (typeof id !== 'string') throw new Error('id must be a string')
    if (markOpen !== undefined && typeof markOpen !== 'boolean') throw new Error('markOpen must be a boolean')
    return deps.runs.get(id, markOpen ?? false) ?? null
  })

  handle(IpcChannels.runsArtifact, (artifactId) => {
    if (typeof artifactId !== 'number' || !Number.isSafeInteger(artifactId)) {
      throw new Error('artifactId must be an integer')
    }
    return deps.runs.artifactData(artifactId)
  })

  handle(IpcChannels.runsDelete, (id) => {
    if (typeof id !== 'string') throw new Error('id must be a string')
    const removed = deps.runs.remove(id)
    if (removed) deps.broadcast(IpcChannels.runsChanged)
    return removed
  })

  handle(IpcChannels.runsPurge, () => {
    const result = deps.runs.purge()
    if (result.removed > 0) deps.broadcast(IpcChannels.runsChanged)
    return result
  })

  handle(IpcChannels.repairsList, (payload) => {
    const routineId = isRecord(payload) ? payload['routineId'] : undefined
    if (routineId !== undefined && typeof routineId !== 'string') throw new Error('routineId must be a string')
    return deps.proposals.list(routineId)
  })

  handle(IpcChannels.repairsAccept, (payload) => {
    const proposal = takeProposal(deps, payload)
    if (!isLikeForLike(asStepRepair(proposal))) {
      throw new Error('this repair changed more than one step, so it cannot be written back — edit the automation instead')
    }
    const routine = deps.user.get(proposal.routineId)
    if (!routine) throw new Error(`no user routine with id "${proposal.routineId}"`)
    if (isStaleRepair(asStepRepair(proposal), routine.definition)) {
      throw new Error('this automation has changed since the repair, so the step it fixed is no longer there')
    }

    const saved = deps.accept(() => {
      if (!deps.proposals.decide(proposal.id, 'accepted')) {
        throw new Error('this repair has already been decided')
      }
      return deps.user.save(
        {
          id: routine.id,
          name: routine.name,
          description: routine.description,
          source: routine.source,
          definition: applyRepairs(routine.definition, [asStepRepair(proposal)])
        },
        { reason: 'repair', decidedBy: proposal.id }
      )
    })
    deps.broadcast(IpcChannels.repairsChanged)
    deps.broadcast(IpcChannels.changed)
    return saved
  })

  handle(IpcChannels.repairsAcceptOnce, (payload) => {
    const proposal = takeProposal(deps, payload)
    const decided = deps.proposals.decide(proposal.id, 'accepted-once')
    if (decided) deps.broadcast(IpcChannels.repairsChanged)
    return decided
  })

  handle(IpcChannels.repairsReject, (payload) => {
    const proposal = takeProposal(deps, payload)
    const decided = deps.proposals.decide(proposal.id, 'rejected')
    if (decided) deps.broadcast(IpcChannels.repairsChanged)
    return decided
  })

  handle(IpcChannels.sitesList, () => deps.sites.origins())

  handle(IpcChannels.sitesLandmarks, (payload) => {
    const origin = isRecord(payload) ? payload['origin'] : undefined
    if (typeof origin !== 'string') throw new Error('origin must be a string')
    return deps.sites.forOrigin(origin)
  })

  handle(IpcChannels.sitesForget, (payload) => {
    const origin = isRecord(payload) ? payload['origin'] : undefined
    if (typeof origin !== 'string') throw new Error('origin must be a string')
    const removed = deps.sites.forget(origin)
    if (removed > 0) deps.broadcast(IpcChannels.sitesChanged)
    return removed
  })

  handle(IpcChannels.sitesPurge, () => {
    const removed = deps.sites.purge()
    if (removed > 0) deps.broadcast(IpcChannels.sitesChanged)
    return removed
  })

  handle(IpcChannels.userRevisions, (payload) => {
    if (typeof payload !== 'string') throw new Error('routineId must be a string')
    return deps.user.revisions(payload)
  })

  handle(IpcChannels.exportPrepare, (payload) => {
    const file = routineFileFor(deps, payload)
    return { file, secrets: findSecrets(file) }
  })

  handle(IpcChannels.exportWrite, async (payload) => {
    const file = assertRoutineFile(payload)
    const target = await askWhereToSave(file.name)
    if (!target) return null
    await fs.promises.writeFile(target, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
    return { path: target }
  })

  handle(IpcChannels.importOpen, async () => {
    const chosen = await askWhichToOpen()
    if (!chosen) return null

    const raw = await fs.promises.readFile(chosen, 'utf8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('that file is not valid JSON')
    }
    const file = assertRoutineFile(parsed)
    return { file, review: reviewRoutineFile(file), path: chosen }
  })

  handle(IpcChannels.importSave, (payload) => {
    if (!isRecord(payload)) throw new Error('import payload must be an object')
    const { overwrite } = payload
    if (overwrite !== undefined && typeof overwrite !== 'boolean') throw new Error('overwrite must be a boolean')
    const file = assertRoutineFile(payload['file'])

    const saved = deps.user.save(
      {
        name: file.name,
        description: file.description,
        definition: file.definition,
        source: 'import',
        ...(overwrite === true ? { overwrite: true } : {})
      },
      { reason: 'import' }
    )
    deps.broadcast(IpcChannels.changed)
    return saved
  })

  handle(IpcChannels.userRevert, (payload) => {
    if (!isRecord(payload)) throw new Error('revert payload must be an object')
    const { routineId, revision } = payload
    if (typeof routineId !== 'string') throw new Error('routineId must be a string')
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision)) {
      throw new Error('revision must be an integer')
    }
    const routine = deps.user.get(routineId)
    if (!routine) throw new Error(`no user routine with id "${routineId}"`)

    const saved = deps.user.save({
      id: routine.id,
      name: routine.name,
      description: routine.description,
      source: routine.source,
      definition: deps.user.definitionAt(routineId, revision)
    })
    deps.broadcast(IpcChannels.changed)
    return saved
  })
}

function resolveRoutine(
  deps: IpcDeps,
  kind: 'system' | 'user',
  id: string
): { routine: SystemRoutine | UserRoutine; revision: number | null } {
  if (kind === 'user') {
    const routine = deps.user.get(id)
    if (!routine) throw new Error(`no user routine with id "${id}"`)
    return { routine, revision: routine.revision }
  }
  const routine = deps.system.get(id)
  if (!routine) throw new Error(`no system routine with id "${id}"`)
  return { routine, revision: null }
}

function assertParamsFilled(definition: RoutineDefinition, params: Record<string, string>): void {
  const blank = requiredParams(definition, params)
  if (blank.length === 0) return
  throw new Error(`this automation still needs a value for ${blank.join(', ')}`)
}

function startRoutineRun(
  deps: IpcDeps,
  kind: 'system' | 'user',
  id: string,
  params: Record<string, string>,
  chain: Partial<RunOpenMeta>,
  resume?: ResumeDescriptor
): Promise<RunResult> {
  const { routine, revision } = resolveRoutine(deps, kind, id)
  assertParamsFilled(routine.definition, params)

  const target = { name: routine.name, description: routine.description, definition: routine.definition }
  const observer = runObserver(deps, {
    routineId: id,
    routineKind: kind,
    routineName: routine.name,
    params,
    definitionHash: definitionHash(routine.definition),
    routineRevision: revision,
    ...chain
  })
  return deps.automation.runRoutine(target, params, observer, resume)
}

function routineRunFor(
  deps: IpcDeps,
  runId: string,
  verb: string
): { run: RunDetail; kind: 'system' | 'user'; id: string; params: Record<string, string> } {
  const run = deps.runs.get(runId)
  if (!run) throw new Error(`no run with id "${runId}"`)
  if (run.source !== 'routine' || run.routineId === null || run.routineKind === null) {
    throw new Error(`this run was a chat goal, not a saved automation, so there is nothing to ${verb}`)
  }
  return { run, kind: run.routineKind, id: run.routineId, params: run.params }
}

interface ResumePlanFor {
  plan: ResumePlan | ResumeRefusal
  kind: 'system' | 'user'
  id: string
  params: Record<string, string>
}

function resumePlanFor(deps: IpcDeps, runId: string, startIndex?: number): ResumePlanFor {
  const { run, kind, id, params } = routineRunFor(deps, runId, 'resume')
  const { routine } = resolveRoutine(deps, kind, id)

  const extracted: Record<string, string> = {}
  for (const artifact of run.artifacts) {
    if (artifact.kind === 'extract') extracted[artifact.label] = artifact.text ?? ''
  }
  let lastExecutedIndex = -1
  for (const step of run.steps) lastExecutedIndex = Math.max(lastExecutedIndex, step.stepIndex)

  const plan = planResume({
    definition: routine.definition,
    status: run.status,
    errorKind: run.errorKind,
    failedStepIndex: run.failedStepIndex,
    lastExecutedIndex,
    params,
    extracted,
    resumeVars: run.resumeVars,
    resumeStartIndex: run.resumeStartIndex,
    committingIndexes: deps.runs.chainCommitting(runId),
    repairs: run.repairs,
    recordedHash: run.definitionHash,
    chainRepairsUsed: deps.runs.chainRepairsUsed(runId),
    hash: (steps) => definitionHash({ steps }),
    startIndex
  })

  return { plan, kind, id, params }
}

function routineFileFor(deps: IpcDeps, payload: unknown): RoutineFile {
  if (!isRecord(payload)) throw new Error('export payload must be an object')
  const { kind, id } = payload
  if (kind !== 'system' && kind !== 'user') throw new Error('kind must be "system" or "user"')
  if (typeof id !== 'string') throw new Error('id must be a string')

  const routine = kind === 'system' ? deps.system.get(id) : deps.user.get(id)
  if (!routine) throw new Error(`no ${kind} routine with id "${id}"`)
  return {
    formatVersion: ROUTINE_FILE_FORMAT_VERSION,
    name: routine.name,
    description: routine.description,
    definition: routine.definition
  }
}

function suggestedFileName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${slug || 'automation'}.automation.json`
}

const FILE_FILTERS = [{ name: 'Automation', extensions: ['json'] }]

async function askWhereToSave(name: string): Promise<string | null> {
  const options = { title: 'Export automation', defaultPath: suggestedFileName(name), filters: FILE_FILTERS }
  const parent = BrowserWindow.getFocusedWindow()
  const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
  return result.canceled ? null : (result.filePath ?? null)
}

async function askWhichToOpen(): Promise<string | null> {
  const options = { title: 'Import automation', properties: ['openFile' as const], filters: FILE_FILTERS }
  const parent = BrowserWindow.getFocusedWindow()
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

function takeProposal(deps: IpcDeps, payload: unknown): RepairProposal {
  if (!isRecord(payload)) throw new Error('payload must be an object')
  const id = payload['proposalId']
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) throw new Error('proposalId must be an integer')
  const proposal = deps.proposals.get(id)
  if (!proposal) throw new Error(`no repair proposal with id ${id}`)
  return proposal
}

function asRunListQuery(query: Record<string, unknown>): { limit?: number; source?: 'routine' | 'chat' } {
  const { limit, source } = query
  if (limit !== undefined && (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1)) {
    throw new Error('limit must be a positive integer')
  }
  if (source !== undefined && source !== 'routine' && source !== 'chat') {
    throw new Error('source must be "routine" or "chat"')
  }
  return { limit, source }
}

async function browserStatus(deps: IpcDeps): Promise<BrowserStatus> {
  return {
    supported: deps.browserHost !== null,
    running: deps.browserHost ? await deps.browserHost.browserRunning() : false
  }
}

function announceBrowserStatus(deps: IpcDeps): void {
  if (!deps.browserHost) return
  void browserStatus(deps).then(
    (status) => deps.broadcast(IpcChannels.browserStatus, status),
    () => {}
  )
}

// Every write goes through main once, before the broadcast, so two windows
// cannot double-write; a store that throws must never fail the run.
function runObserver(deps: IpcDeps, meta: RunOpenMeta): RunObserver {
  let opened = false
  const guard = (write: () => void): void => {
    try {
      write()
    } catch (error) {
      console.error('[runs] could not record this run:', error)
    }
  }

  return {
    progress(event) {
      guard(() => deps.runs.record(event, meta))
      deps.broadcast(IpcChannels.automationProgress, event)
      const settled = TERMINAL.has(event.status)
      if (!opened || settled) deps.broadcast(IpcChannels.runsChanged)
      if (settled) announceBrowserStatus(deps)
      opened = true
    },
    artifact(runId, artifact) {
      guard(() => deps.runs.addArtifact(runId, artifact))
    },
    repair(runId, repair) {
      guard(() => deps.runs.addRepair(runId, repair))
      if (meta.routineKind !== 'user' || !meta.routineId) return
      const routineId = meta.routineId
      guard(() => {
        deps.proposals.propose(routineId, runId, repair, deps.runs.repairScreenshot(runId, repair.stepIndex))
        deps.broadcast(IpcChannels.repairsChanged)
      })
    },
    recorded(runId, steps) {
      guard(() => deps.runs.setRecordedSteps(runId, steps))
    },
    step(runId, record) {
      guard(() => deps.runs.recordStep(runId, record))
    },
    usage(runId, totals) {
      guard(() => deps.runs.recordUsage(runId, totals))
    },
    learned(fact) {
      guard(() => deps.sites.observe(fact))
    },
    scored(origin, kind, factKey, worked) {
      guard(() => deps.sites.scoreUse(origin, kind, factKey, worked))
    }
  }
}
