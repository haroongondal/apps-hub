import { requireNativeModule } from 'expo';
import { normalize, type FaceOptions, type Settings } from './settings.ts';

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

export interface FaceInfo {
  id: string;
  name: string;
  /** The face can show seconds, so the Seconds option applies to it. */
  supportsSeconds: boolean;
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
  listPatterns(): PatternInfo[];
  listApps(): Promise<AppInfo[]>;
  appIconUri(pkg: string): Promise<string | null>;
  pickBackground(themeId: string): Promise<boolean>;
  clearBackground(themeId: string): Promise<void>;
  renderFacePreview(themeId: string, width: number, height: number): Promise<string>;
  previewAod(themeId: string): void;
  listFaces(): FaceInfo[];
  renderFaceThumb(faceId: string, options: FaceOptions, colours: string[], width: number, height: number): Promise<string>;
  addListener(event: 'onStatus', listener: (s: Status) => void): Subscription;
}

const native = requireNativeModule<NativeApi>('HaloEngine');

export interface HaloEngineApi {
  start(): void;
  stop(): void;
  /** Also restarts a killed service when something needs it, unless Stop was pressed since the app opened. */
  getStatus(): Status;
  openPermission(kind: PermissionKind): void;
  probeLog(): string;
  clearProbeLog(): void;
  getSettings(): Settings;
  setSettings(s: Settings): void;
  /** On while a settings screen is open: the lights show even when switched off, moving by themselves if nothing plays. */
  setPreview(on: boolean): void;
  listPatterns(): PatternInfo[];
  /** Launchable apps, those that have notified first, then by label. */
  listApps(): Promise<AppInfo[]>;
  /** A file:// URI of the app's icon as a 96 px PNG; null when the app is not installed. */
  appIconUri(pkg: string): Promise<string | null>;
  /** Opens the system photo picker and stores a copy (long side 1440 px) as the theme's background; false when cancelled. The theme must already be saved in settings. */
  pickBackground(themeId: string): Promise<boolean>;
  /** Deletes the theme's photo and sets photo=false. Call it before removing a theme from settings so no photo is left behind. */
  clearBackground(themeId: string): Promise<void>;
  /** A file:// URI of a PNG (width x height px) of the theme's face on its background, drawn now with sample values. */
  renderFacePreview(themeId: string, width: number, height: number): Promise<string>;
  /** Opens the always-on screen with this theme over the app (not over the lock screen); back or a tap closes it. */
  previewAod(themeId: string): void;
  /** Every face the always-on screen can draw, in the order the grid shows them. */
  listFaces(): FaceInfo[];
  /** A file:// URI of a PNG (width x height px) of one face on black with these options and 1 to 4 '#RRGGBB' colours, drawn now with sample values. An unknown face draws big-digits. */
  renderFaceThumb(faceId: string, options: FaceOptions, colours: string[], width: number, height: number): Promise<string>;
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
  listPatterns: () => native.listPatterns(),
  listApps: async () =>
    (await native.listApps()).map((a) => ({ pkg: String(a.pkg), label: String(a.label), notified: a.notified === true })),
  appIconUri: async (pkg) => (await native.appIconUri(pkg)) ?? null,
  pickBackground: async (themeId) => (await native.pickBackground(themeId)) === true,
  clearBackground: (themeId) => native.clearBackground(themeId),
  renderFacePreview: async (themeId, width, height) => String(await native.renderFacePreview(themeId, Math.round(width), Math.round(height))),
  previewAod: (themeId) => native.previewAod(themeId),
  listFaces: () => native.listFaces().map((f) => ({ id: String(f.id), name: String(f.name), supportsSeconds: f.supportsSeconds === true })),
  renderFaceThumb: async (faceId, options, colours, width, height) =>
    String(await native.renderFaceThumb(faceId, options, colours, Math.round(width), Math.round(height))),
  addStatusListener: (cb) => native.addListener('onStatus', cb),
};

export default HaloEngine;
