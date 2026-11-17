// Pure and platform-free so node --test can run it. Mirrors core/Settings.kt; both read fixtures/settings.cases.json.
export type ColorSource = 'palette' | 'albumArt' | 'wallpaper';
export type Quad = [number, number, number, number];

/** 'pulse', 'sweep' or any edge pattern id. */
export type FlashStyle = string;
/** colour is '#RRGGBB', or null to take it from the app icon. */
export interface AppNotify { on: boolean; colour: string | null }
export type ReminderMin = 1 | 2 | 5 | 10 | 15;
export interface Notify {
  enabled: boolean;
  apps: Record<string, AppNotify>;
  defaultOn: boolean;
  style: FlashStyle;
  repeat: number; // 1..5
  durationMs: number; // 500..5000
  reminderMin: ReminderMin | null;
  wakeScreen: boolean; // used in stage 4
  quiet: { on: boolean; start: string; end: string };
}
export interface Rules {
  apps: string[];
  fullscreen: boolean;
  landscape: boolean;
  calls: boolean;
  batterySaver: boolean;
  pocket: boolean;
}

export interface Settings {
  version: 1;
  enabled: boolean;
  pattern: string;
  params: {
    thickness: number;
    speed: number;
    spread: number;
    glow: number;
    padding: number;
    roundness: number;
    mirrored: boolean;
    clockwise: boolean;
  };
  colors: { source: ColorSource; palette: string[] };
  edges: { auto: boolean; corners: Quad; insets: Quad };
  notify: Notify;
  rules: Rules;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  enabled: true,
  pattern: 'pulse-ring',
  params: { thickness: 4, speed: 0.5, spread: 0.5, glow: 0.6, padding: 0, roundness: 1, mirrored: false, clockwise: true },
  colors: { source: 'albumArt', palette: ['#22D3EE', '#A78BFA'] },
  edges: { auto: true, corners: [0, 0, 0, 0], insets: [0, 0, 0, 0] },
  notify: {
    enabled: true,
    apps: {},
    defaultOn: true,
    style: 'pulse',
    repeat: 2,
    durationMs: 1500,
    reminderMin: null,
    wakeScreen: false,
    quiet: { on: false, start: '22:00', end: '07:00' },
  },
  rules: { apps: [], fullscreen: true, landscape: false, calls: true, batterySaver: true, pocket: false },
};

const PKG = /^[a-zA-Z0-9_.]{1,200}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_APPS = 500;
const REMINDERS = [1, 2, 5, 10, 15] as const;

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const num = (v: unknown, d: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
const int = (v: unknown, max: number) => Math.round(num(v, 0, 0, max));
const quad = (v: unknown, max: number): Quad => {
  const a = Array.isArray(v) ? v : [];
  return [int(a[0], max), int(a[1], max), int(a[2], max), int(a[3], max)];
};

const time = (v: unknown, d: string) => (typeof v === 'string' && TIME.test(v) ? v : d);

function normalizeNotify(raw: unknown): Notify {
  const d = DEFAULT_SETTINGS.notify;
  const n = obj(raw);
  const q = obj(n.quiet);
  // fromEntries makes own properties, so a package key like "__proto__" cannot reach the prototype.
  const apps = Object.fromEntries(
    Object.entries(obj(n.apps))
      .filter(([k, v]) => PKG.test(k) && typeof v === 'object' && v !== null && !Array.isArray(v))
      .slice(0, MAX_APPS)
      .map(([k, v]): [string, AppNotify] => {
        const a = obj(v);
        return [k, { on: bool(a.on, true), colour: typeof a.colour === 'string' && HEX.test(a.colour) ? a.colour.toUpperCase() : null }];
      }),
  );
  return {
    enabled: bool(n.enabled, d.enabled),
    apps,
    defaultOn: bool(n.defaultOn, d.defaultOn),
    style: typeof n.style === 'string' && /^[a-z0-9-]{1,40}$/.test(n.style) ? n.style : d.style,
    repeat: Math.round(num(n.repeat, d.repeat, 1, 5)),
    durationMs: Math.round(num(n.durationMs, d.durationMs, 500, 5000)),
    reminderMin: REMINDERS.find((m) => m === n.reminderMin) ?? null,
    wakeScreen: bool(n.wakeScreen, d.wakeScreen),
    quiet: { on: bool(q.on, d.quiet.on), start: time(q.start, d.quiet.start), end: time(q.end, d.quiet.end) },
  };
}

function normalizeRules(raw: unknown): Rules {
  const d = DEFAULT_SETTINGS.rules;
  const r = obj(raw);
  return {
    apps: (Array.isArray(r.apps) ? r.apps : []).filter((x): x is string => typeof x === 'string' && PKG.test(x)).slice(0, MAX_APPS),
    fullscreen: bool(r.fullscreen, d.fullscreen),
    landscape: bool(r.landscape, d.landscape),
    calls: bool(r.calls, d.calls),
    batterySaver: bool(r.batterySaver, d.batterySaver),
    pocket: bool(r.pocket, d.pocket),
  };
}

/** Any input becomes a valid Settings: wrong types fall back, numbers clamp, unknown fields drop. Never throws. */
export function normalize(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const r = obj(raw);
  const p = obj(r.params);
  const c = obj(r.colors);
  const e = obj(r.edges);
  const palette = (Array.isArray(c.palette) ? c.palette : [])
    .filter((x): x is string => typeof x === 'string' && /^#[0-9a-fA-F]{6}$/.test(x))
    .slice(0, 4)
    .map((x) => x.toUpperCase());
  return {
    version: 1,
    enabled: bool(r.enabled, d.enabled),
    // The service maps a well-formed but unregistered id to pulse-ring when it builds the pattern.
    pattern: typeof r.pattern === 'string' && /^[a-z0-9-]{1,40}$/.test(r.pattern) ? r.pattern : d.pattern,
    params: {
      thickness: num(p.thickness, d.params.thickness, 1, 24),
      speed: num(p.speed, d.params.speed, 0, 1),
      spread: num(p.spread, d.params.spread, 0, 1),
      glow: num(p.glow, d.params.glow, 0, 1),
      padding: num(p.padding, d.params.padding, 0, 32),
      roundness: num(p.roundness, d.params.roundness, 0, 1.5),
      mirrored: bool(p.mirrored, d.params.mirrored),
      clockwise: bool(p.clockwise, d.params.clockwise),
    },
    colors: {
      source: c.source === 'palette' || c.source === 'albumArt' || c.source === 'wallpaper' ? c.source : d.colors.source,
      palette: palette.length > 0 ? palette : [...d.colors.palette],
    },
    edges: { auto: bool(e.auto, d.edges.auto), corners: quad(e.corners, 400), insets: quad(e.insets, 200) },
    notify: normalizeNotify(r.notify),
    rules: normalizeRules(r.rules),
  };
}
