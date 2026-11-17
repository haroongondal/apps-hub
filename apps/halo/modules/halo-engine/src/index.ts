import { requireNativeModule } from 'expo';
import { normalize, type Settings } from './settings.ts';

export * from './settings.ts';

export type PermissionKind = 'overlay' | 'listener' | 'battery' | 'appDetails' | 'usage';

export interface Status {
  running: boolean;
  overlayAllowed: boolean;
  listenerAllowed: boolean;
  audioAllowed: boolean;
  notificationsAllowed: boolean;
  /** Battery optimisation is off for Halo, so the system does not stop it in the background. */
  batteryUnrestricted: boolean;
  /** Usage access, needed only to hide the lights while chosen apps are open. */
  usageAllowed: boolean;
  /** "blocked" means another app holds the audio effect; "idle" means no sound has arrived yet. */
  audio: 'ok' | 'blocked' | 'idle';
  playingApp: string | null;
  frameP95Ms: number | null;
}

export type PatternFamily = 'lights' | 'lines' | 'particles' | 'waves';

export interface PatternInfo {
  id: string;
  family: PatternFamily;
  name: string;
}

export interface AppInfo {
  pkg: string;
  label: string;
  /** The app has posted a notification since Halo could see them. */
  notified: boolean;
}

export interface Subscription {
  remove(): void;
}

interface NativeApi {
  start(): void;
  stop(): void;
  getStatus(): Status;
  openPermission(kind: PermissionKind): void;
  probeLog(): string;
  clearProbeLog(): void;
  getSettings(): string;
  setSettings(json: string): void;
  setPreview(on: boolean): void;
  getAodSpike(): boolean;
  setAodSpike(on: boolean): void;
  listPatterns(): PatternInfo[];
  listApps(): Promise<AppInfo[]>;
  appIconUri(pkg: string): Promise<string | null>;
  addListener(event: 'onStatus', listener: (s: Status) => void): Subscription;
}

const native = requireNativeModule<NativeApi>('HaloEngine');

export interface HaloEngineApi {
  start(): void;
  stop(): void;
  getStatus(): Status;
  openPermission(kind: PermissionKind): void;
  probeLog(): string;
  clearProbeLog(): void;
  getSettings(): Settings;
  setSettings(s: Settings): void;
  /** On while a settings screen is open: the lights show even when switched off, moving by themselves if nothing plays. */
  setPreview(on: boolean): void;
  /** Diagnostics switch "Test the always-on screen": shows a clock when a locked phone's screen goes off. Off by default. */
  getAodSpike(): boolean;
  setAodSpike(on: boolean): void;
  listPatterns(): PatternInfo[];
  /** Launchable apps, those that have notified first, then by label. */
  listApps(): Promise<AppInfo[]>;
  /** A file:// URI of the app's icon as a 96 px PNG; null when the app is not installed. */
  appIconUri(pkg: string): Promise<string | null>;
  addStatusListener(cb: (s: Status) => void): Subscription;
}

const HaloEngine: HaloEngineApi = {
  start: () => native.start(),
  stop: () => native.stop(),
  getStatus: () => native.getStatus(),
  openPermission: (kind) => native.openPermission(kind),
  probeLog: () => native.probeLog(),
  clearProbeLog: () => native.clearProbeLog(),
  getSettings: () => normalize(JSON.parse(native.getSettings())),
  setSettings: (s) => native.setSettings(JSON.stringify(s)),
  setPreview: (on) => native.setPreview(on),
  getAodSpike: () => native.getAodSpike() === true,
  setAodSpike: (on) => native.setAodSpike(on),
  listPatterns: () => native.listPatterns(),
  listApps: async () =>
    (await native.listApps()).map((a) => ({ pkg: String(a.pkg), label: String(a.label), notified: a.notified === true })),
  appIconUri: async (pkg) => (await native.appIconUri(pkg)) ?? null,
  addStatusListener: (cb) => native.addListener('onStatus', cb),
};

export default HaloEngine;
