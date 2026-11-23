import { requireNativeModule } from 'expo';

export type ServiceKey = 'groq' | 'gemini';
export type JobKey = 'chat' | 'vision' | 'embed' | 'transcribe';

export interface KeyInfo {
  index: number;
  service: ServiceKey | '';
  label: string;
}

export interface ModelChoice {
  service: ServiceKey;
  model: string;
}

export interface AppInfo {
  packageName: string;
  label: string;
  enabled: boolean;
  /** Asked to use AI before the owner turned it on or off. */
  pending: boolean;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  lastUsed: number;
}

/** One finished request. The log never holds what was asked or answered. */
export interface CallInfo {
  packageName: string;
  label: string;
  job: JobKey;
  service: ServiceKey;
  time: number;
}

interface AiHubCoreApi {
  apiVersion(): number;
  keys(): Promise<KeyInfo[]>;
  addKey(key: string): Promise<void>;
  removeKey(index: number): Promise<void>;
  clearKeys(): Promise<void>;
  models(): Promise<Record<JobKey, ModelChoice>>;
  setModel(job: JobKey, service: ServiceKey, model: string): Promise<void>;
  apps(): Promise<AppInfo[]>;
  setAppEnabled(packageName: string, enabled: boolean): Promise<void>;
  calls(): Promise<CallInfo[]>;
  clearCalls(): Promise<void>;
}

const native = requireNativeModule<AiHubCoreApi>('AiHubCore');

/** The native contract version, so the JS side can refuse a stale build. */
export function apiVersion(): number {
  const v = native.apiVersion();
  return typeof v === 'number' && Number.isInteger(v) ? v : 0;
}

/** Labels only: a key itself never leaves the native side. */
export const keys = (): Promise<KeyInfo[]> => native.keys();
export const addKey = (key: string): Promise<void> => native.addKey(key);
export const removeKey = (index: number): Promise<void> => native.removeKey(index);
export const clearKeys = (): Promise<void> => native.clearKeys();
export const models = (): Promise<Record<JobKey, ModelChoice>> => native.models();
export const setModel = (job: JobKey, service: ServiceKey, model: string): Promise<void> => native.setModel(job, service, model);
export const apps = (): Promise<AppInfo[]> => native.apps();
export const setAppEnabled = (packageName: string, enabled: boolean): Promise<void> => native.setAppEnabled(packageName, enabled);
export const calls = (): Promise<CallInfo[]> => native.calls();
export const clearCalls = (): Promise<void> => native.clearCalls();
