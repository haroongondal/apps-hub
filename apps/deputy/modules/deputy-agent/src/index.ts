import { requireNativeModule } from 'expo';

export interface ServiceState {
  /** Switched on in Settings; it may not be bound yet right after a boot. */
  accessibilityEnabled: boolean;
  notificationsAllowed: boolean;
  batteryUnrestricted: boolean;
  keySet: boolean;
  /** Optional: lets find_contact read numbers. */
  contactsAllowed: boolean;
  runActive: boolean;
}

export interface TreeDump {
  pkg: string | null;
  nodes: number;
  text: string;
}

export type RunStatus = 'done' | 'failed' | 'stopped' | 'declined' | 'capped' | 'interrupted';

export interface Gate {
  id: string;
  kind: 'confirm' | 'question';
  app: string;
  /** For a question, the question itself. */
  action: string;
  target: string | null;
  draftText: string | null;
  reason: string | null;
  options: string[];
  expiresAt: number;
}

export type RunEvent =
  | {
      type: 'step';
      runId: string;
      n: number;
      app: string;
      action: string;
      verdict: 'allow' | 'confirm' | 'deny' | 'none' | 'question';
      result: string;
      costUsd: number;
      /** The model call that chose the step, and the action plus the wait for the screen to settle. 0 in older runs. */
      modelMs: number;
      actMs: number;
    }
  | { type: 'gate'; runId: string; gate: Gate }
  | { type: 'finished'; runId: string; status: RunStatus; summary: string | null; costUsd: number };

export interface RunSnapshot {
  runId: string | null;
  active: boolean;
  events: RunEvent[];
  gate: Gate | null;
}

export type TrustLevel = 'blocked' | 'read_only' | 'standard';

export interface AppTrust {
  pkg: string;
  label: string;
  trust: TrustLevel;
  /** A money app by default, so it needs its name typed before it can be standard. */
  financial: boolean;
}

/** Prices are dollars per million tokens. With `customPrices` false they are the known model's published prices. */
export interface Settings {
  baseUrl: string;
  model: string;
  /** The known model's name, or '' for one Deputy doesn't know. Read-only. */
  knownModel: string;
  customPrices: boolean;
  inputPerM: number;
  cachedPerM: number;
  outputPerM: number;
  maxSteps: number;
  maxCostUsd: number;
  maxMinutes: number;
  dailyCostUsd: number;
}

/** A model whose prices Deputy knows. A model that can't read `images` works from the screen's text only. */
export interface KnownModel {
  name: string;
  baseUrl: string;
  model: string;
  images: boolean;
  inputPerM: number;
  cachedPerM: number;
  outputPerM: number;
}

export interface RunSummary {
  runId: string;
  task: string;
  startedAt: number;
  status: RunStatus | 'running';
  summary: string | null;
  costUsd: number;
  steps: number;
}

export interface SavedTask {
  id: string;
  name: string;
  task: string;
  /** Package names. Empty means any app the trust table allows. */
  apps: string[];
}

interface DeputyAgentApi {
  getServiceState(): ServiceState;
  openAccessibilitySettings(): void;
  openAppInfo(): void;
  openBatterySettings(): void;
  /** False when the service isn't connected, so the caller must send the owner to Accessibility settings. */
  disableService(): boolean;
  startRun(task: string, allowedApps?: string[] | null): { runId: string | null; error: string | null };
  stopRun(): void;
  /** False when the gate is unknown, already answered or expired. A question's answer never counts as approval. */
  resolveGate(gateId: string, approve: boolean, text: string | null): boolean;
  getRun(): RunSnapshot;
  listRuns(limit: number): RunSummary[];
  getRunLog(runId: string): RunEvent[];
  /** Keeps a run in progress, and today's spend still counts toward the daily limit. */
  clearHistory(): void;
  listApps(): Promise<AppTrust[]>;
  /** Copy for the screen when the change isn't allowed, or null once saved. */
  setAppTrust(pkg: string, level: TrustLevel, typedConfirmation: string | null): Promise<string | null>;
  getSettings(): Settings;
  knownModels(): KnownModel[];
  /** Copy for the screen when a value isn't valid, or null once saved. A new address removes the saved key. */
  setSettings(settings: Settings): string | null;
  listSavedTasks(): SavedTask[];
  saveTask(task: Omit<SavedTask, 'id'> & { id: string | null }): { id: string | null; error: string | null };
  deleteTask(id: string): void;
  setApiKey(key: string): void;
  clearApiKey(): void;
  testProvider(): Promise<{ ok: boolean; message: string }>;
  setPalette(json: string): void;
  listen(prompt: string): Promise<string | null>;
  /** Debug: waits so the owner can switch apps, then dumps the app in front. Never dumps Deputy's own screens. */
  dumpForegroundTree(delaySeconds: number): Promise<TreeDump>;
  copyToClipboard(text: string): void;
  addListener(event: 'onRunEvent', listener: (e: RunEvent) => void): { remove(): void };
}

export default requireNativeModule<DeputyAgentApi>('DeputyAgent');
