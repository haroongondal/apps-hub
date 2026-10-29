import { requireNativeModule } from 'expo';

export interface ServiceState {
  /** Switched on in Settings; it may not be bound yet right after a boot. */
  accessibilityEnabled: boolean;
  notificationsAllowed: boolean;
  batteryUnrestricted: boolean;
  keySet: boolean;
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
  | { type: 'step'; runId: string; n: number; app: string; action: string; verdict: 'allow' | 'confirm' | 'deny' | 'none' | 'question'; result: string; costUsd: number }
  | { type: 'gate'; runId: string; gate: Gate }
  | { type: 'finished'; runId: string; status: RunStatus; summary: string | null; costUsd: number };

export interface RunSnapshot {
  runId: string | null;
  active: boolean;
  events: RunEvent[];
  gate: Gate | null;
}

interface DeputyAgentApi {
  getServiceState(): ServiceState;
  openAccessibilitySettings(): void;
  openAppInfo(): void;
  openBatterySettings(): void;
  /** False when the service isn't connected, so the caller must send the owner to Accessibility settings. */
  disableService(): boolean;
  startRun(task: string): { runId: string | null; error: string | null };
  stopRun(): void;
  /** False when the gate is unknown, already answered or expired. A question's answer never counts as approval. */
  resolveGate(gateId: string, approve: boolean, text: string | null): boolean;
  getRun(): RunSnapshot;
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
