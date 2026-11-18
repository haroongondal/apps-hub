import type { LandmarkKind, SiteFact } from './site-memory'

// `intent` is what the step is *for*. Repairing a step needs its purpose, not
// just its selector; chat-recorded steps take it from the model's description.
export type ActionStep = { intent?: string } & (
  | { kind: 'navigate'; url: string }
  | { kind: 'click'; selector: string }
  | { kind: 'type'; selector: string; text: string; submit?: boolean }
  | { kind: 'select'; selector: string; value: string }
  | { kind: 'wait'; forSelector?: string; ms?: number }
  | { kind: 'scroll'; selector?: string; to?: 'top' | 'bottom' }
  | { kind: 'screenshot'; label?: string }
  | { kind: 'extract'; selector: string; into: string }
  | {
      kind: 'assert'
      selector: string
      expect?: 'present' | 'absent'
      containsText?: string
      message?: string
    }
)

export interface RoutineParam {
  description?: string
  required?: boolean
  default?: string
}

export interface RoutineDefinition {
  steps: ActionStep[]
  params?: Record<string, RoutineParam>
}

export interface SystemRoutine {
  id: string
  name: string
  version: number
  description: string | null
  definition: RoutineDefinition
  checksum: string
  sourceFile: string
  loadedAt: number
}

export interface UserRoutine {
  id: string
  name: string
  description: string | null
  definition: RoutineDefinition
  source: 'chat' | 'import'
  revision: number
  createdAt: number
  updatedAt: number
}

export type RepairDecision = 'accepted' | 'accepted-once' | 'rejected'

export interface RepairProposal {
  id: number
  routineId: string
  runId: string | null
  stepIndex: number
  reason: string
  original: ActionStep
  replacement: ActionStep[]
  screenshotPath: string | null
  createdAt: number
}

export interface RoutineRevision {
  revision: number
  reason: 'manual' | 'repair' | 'import'
  decidedBy: number | null
  createdAt: number
}

export interface RoutineFile {
  formatVersion: number
  name: string
  description: string | null
  definition: RoutineDefinition
}

export interface SaveUserRoutineInput {
  id?: string
  name: string
  description?: string
  definition: RoutineDefinition
  source?: UserRoutine['source']
  overwrite?: boolean
}

export interface SyncResult {
  loaded: number
  errors: string[]
}

export interface RunArtifact {
  label: string
  stepIndex: number
  dataUrl: string
}

// What a run captured, on its way to storage. A screenshot travels as base64 and
// lands on disk; an extract travels as text and lands in the row.
export interface CapturedArtifact {
  kind: 'screenshot' | 'extract' | 'repair'
  stepIndex: number
  label: string
  base64?: string
  text?: string
}

export interface StepRepair {
  stepIndex: number
  reason: string
  original: ActionStep
  replacement: ActionStep[]
  screenshotBase64?: string
}

// What a routine produced, as opposed to whether it succeeded. `extracted` holds
// only the values `extract` steps wrote — not the params the caller passed in.
export interface RunResult {
  runId: string
  extracted: Record<string, string>
  artifacts: RunArtifact[]
  repairs: StepRepair[]
}

// A terminal status is an outcome; `running`, `healing` and `held` are phases.
// `interrupted` is never emitted — the store writes it to close a row that was
// still open when the app quit.
export type RunStatus = 'running' | 'held' | 'done' | 'assisted' | 'error' | 'cancelled' | 'interrupted'

export type ProgressStatus = Exclude<RunStatus, 'interrupted'> | 'healing'

export interface AutomationProgressEvent {
  runId: string
  source: 'routine' | 'chat'
  sessionId?: string
  status: ProgressStatus
  stepIndex: number
  totalSteps?: number
  description: string
  error?: string
  // The resolved step this event is about, absent on phase and terminal events.
  step?: ActionStep
  errorKind?: string
}

// The orchestrator reports more than a progress line. Artifacts and repairs are
// optional so a test can pass `{ progress() {} }` and nothing else.
export interface RunObserver {
  progress(event: AutomationProgressEvent): void
  artifact?(runId: string, artifact: CapturedArtifact): void
  repair?(runId: string, repair: StepRepair): void
  // The steps a chat run actually executed, reported once when the run settles.
  recorded?(runId: string, steps: ActionStep[]): void
  step?(runId: string, record: RunStepRecord): void
  usage?(runId: string, totals: RunUsage): void
  learned?(fact: SiteFact): void
  scored?(origin: string, kind: LandmarkKind, factKey: string, worked: boolean): void
}

export interface StepOutput {
  value?: string
  // Absent for kinds the extension does not verify; false means the page did
  // not react, which is a suspicion to investigate rather than a failure.
  changed?: boolean
  committing?: boolean
  via?: 'cdp' | 'synthetic'
  // True when the selector did not resolve on the first look, so layer 0 waited or scrolled for it.
  recovered?: boolean
}

// `direct` and `recovered` both mean nobody was asked; the gap between them is
// what layer 0's selector resolution is worth.
export type ResolvedBy = 'direct' | 'recovered' | 'repair' | 'proceed' | 'human' | 'failed' | 'resumed'

export interface RunStepRecord {
  stepIndex: number
  kind: ActionStep['kind']
  attempts: number
  resolvedBy: ResolvedBy
  changed: boolean | null
  via: 'cdp' | 'synthetic' | null
  recovered: boolean | null
  browserMs: number
  modelMs: number
  heldMs: number
  llmCalls: number
  startedAt: number
  endedAt: number | null
  staticLooks: number | null
  threadTurns: number | null
  stopReason: string | null
  pageFingerprint: string | null
  thinking: boolean | null
  committing: boolean | null
}

export interface RunUsage {
  llmCalls: number
  repairCalls: number
  repairBudgetSpent: number
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
  model: string
}

export interface AutomationHoldEvent {
  held: boolean
  reason: string | null
  // Which run and step are waiting, so a hold can be attributed to a thread.
  runId: string | null
  stepIndex: number | null
  // true when the extension stopped itself on a CAPTCHA or sensitive field,
  // false when the user pressed Pause.
  automatic: boolean
}

export interface ExtensionStatus {
  connected: boolean
  paused: boolean
}

export interface BrowserStatus {
  // false under the extension backend, where the user's own Chrome is the browser.
  supported: boolean
  running: boolean
}

export interface RunRoutineInput {
  kind: 'system' | 'user'
  id: string
  params?: Record<string, string>
}

export interface ResumeDescriptor {
  startIndex: number
  vars: Record<string, string>
  repairsUsed: number
}

export interface ChatSendInput {
  sessionId: string
  goal: string
}

export interface RunArtifactRecord {
  id: number
  kind: 'screenshot' | 'extract' | 'repair'
  stepIndex: number
  label: string
  text: string | null
  hasImage: boolean
}

export interface RunRepairRecord {
  stepIndex: number
  reason: string
  original: ActionStep
  replacement: ActionStep[]
  at: number
}

export interface RunEventRecord {
  seq: number
  status: ProgressStatus
  stepIndex: number
  description: string
  step: ActionStep | null
  error: string | null
  at: number
}

// What happened at each step, so the runs list can draw a run's shape without
// shipping its whole event stream.
export type RunStepOutcome = 'pending' | 'ran' | 'attention' | 'failed'

export interface RunSummary {
  id: string
  source: 'routine' | 'chat'
  routineId: string | null
  routineKind: 'system' | 'user' | null
  routineName: string
  status: RunStatus
  startedAt: number
  endedAt: number | null
  error: string | null
  failedStepIndex: number | null
  stepCount: number
  humanSteps: number
  openedAt: number | null
  recordedSteps: ActionStep[] | null
  stepOutcomes: RunStepOutcome[]
  rerunOf: string | null
  resumedFromRunId: string | null
  resumeStartIndex: number | null
  errorKind: string | null
  definitionHash: string | null
}

export interface RunDetail extends RunSummary {
  params: Record<string, string>
  events: RunEventRecord[]
  artifacts: RunArtifactRecord[]
  repairs: RunRepairRecord[]
  steps: RunStepRecord[]
  usage: RunUsage
  resumeVars: Record<string, string> | null
}

export interface RoutineHealth {
  routineName: string
  source: 'routine' | 'chat'
  runs: number
  unattended: number
  assisted: number
  failed: number
  averageMs: number | null
  llmCalls: number
  tokens: number
  worstStepIndex: number | null
  worstStepTrouble: number
}

export interface RunListQuery {
  limit?: number
  source?: 'routine' | 'chat'
}

export interface PurgeResult {
  removed: number
}

export type QueuePriority = 'interactive' | 'background'

export type QueueEntryState = 'waiting' | 'waiting-for-extension' | 'announcing' | 'running' | 'held'

export type QueueDisposition =
  | 'started'
  | 'cancelled-by-user'
  | 'superseded'
  | 'refused-queue-full'
  | 'expired-no-extension'
  | 'dropped-app-quit'

export type QueueWork =
  | { kind: 'routine'; target: RunRoutineInput; resume?: { fromRunId: string; startIndex: number } }
  | { kind: 'chat'; input: ChatSendInput }
  | { kind: 'lease'; label: string }

export interface QueueEntry {
  id: string
  priority: QueuePriority
  state: QueueEntryState
  work: QueueWork
  enqueuedAt: number
  startedAt: number | null
  announceUntil: number | null
  dedupeKey: string | null
}

export interface QueueDrop {
  id: string
  work: QueueWork
  disposition: QueueDisposition
  message: string
  at: number
}

export interface QueueSnapshot {
  // Position 0 is the running entry whenever there is one.
  entries: QueueEntry[]
  recent: QueueDrop[]
  suspended: boolean
  full: boolean
}

export interface SiteOriginSummary {
  origin: string
  landmarks: number
  lastSeen: number
}
