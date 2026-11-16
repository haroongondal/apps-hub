import { requireNativeModule } from 'expo';

export type PermissionKind = 'overlay' | 'listener' | 'battery' | 'appDetails';

export interface Status {
  running: boolean;
  overlayAllowed: boolean;
  listenerAllowed: boolean;
  audioAllowed: boolean;
  notificationsAllowed: boolean;
  /** "blocked" means another app holds the audio effect; "idle" means no sound has arrived yet. */
  audio: 'ok' | 'blocked' | 'idle';
  playingApp: string | null;
  frameP95Ms: number | null;
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
  addStatusListener(cb: (s: Status) => void): Subscription;
}

const HaloEngine: HaloEngineApi = {
  start: () => native.start(),
  stop: () => native.stop(),
  getStatus: () => native.getStatus(),
  openPermission: (kind) => native.openPermission(kind),
  probeLog: () => native.probeLog(),
  clearProbeLog: () => native.clearProbeLog(),
  addStatusListener: (cb) => native.addListener('onStatus', cb),
};

export default HaloEngine;
