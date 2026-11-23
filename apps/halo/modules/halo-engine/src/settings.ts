// Pure and platform-free so node --test can run it. Mirrors core/Settings.kt; both read fixtures/settings.cases.json.
export type ColorSource = 'palette' | 'albumArt' | 'wallpaper';
export type Quad = [number, number, number, number];

/** 'pulse', 'sweep' or any edge pattern id. */
export type FlashStyle = string;
/** colour is '#RRGGBB', or null for the brand or icon colour; style null follows Notify.style. */
export interface AppNotify { on: boolean; colour: string | null; style: FlashStyle | null }
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

/** Seconds before the always-on screen stops by itself; null = never stop. */
export type AodTimeout = 10 | 30 | 60 | 300 | 900 | 1800 | null;
export type AodTrigger = 'always' | 'charging' | 'music';
export interface FaceOptions {
  size: 's' | 'm' | 'l';
  position: 'top' | 'centre' | 'bottom';
  h24: boolean;
  date: boolean;
  battery: boolean;
  alarm: boolean;
  seconds: boolean;
}
export interface Theme {
  id: string; // [a-z0-9-]{1,40}
  name: string; // 1..40 chars
  /** A face id; only its format is checked here. */
  face: string;
  faceOptions: FaceOptions;
  colours: { source: ColorSource; palette: string[] /* 1..4 */ };
  /** The photo, when true, is the file filesDir/bg/<id>.jpg. */
  photo: boolean;
  dim: number; // 0..0.9
  edge: { on: boolean; pattern: string };
  brightness: number; // 0.005..0.3
}
/** Display order on the always-on screen; mirrors DotKind in core/DotKinds.kt. */
export const DOT_KINDS = ['charging', 'lowBattery', 'call', 'whatsapp', 'instagram', 'message', 'email', 'other', 'alarm', 'media'] as const;
export type DotKind = (typeof DOT_KINDS)[number];
export type ChargeEffect = 'off' | 'sweep';
export interface AodDots {
  on: boolean;
  kinds: Record<DotKind, boolean>;
  /** Show the number on a dot of two or more. */
  count: boolean;
}
export interface Aod {
  enabled: boolean;
  timeoutSec: AodTimeout;
  trigger: AodTrigger;
  /** Off hours: the always-on screen stays off inside this window. */
  schedule: { on: boolean; start: string; end: string };
  themeId: string;
  slots: { start: string; themeId: string }[]; // max 4
  dots: AodDots;
  chargeEffect: ChargeEffect;
  /** Plugging in the charger with the screen off wakes the always-on screen for 10 s, unless the phone is in a pocket. */
  wakeOnCharge: boolean;
}

/** Surfaces fed by the owner's other apps; each switch also decides which of their shares Halo reads. All off by default. */
export interface Links {
  /** Red pulse while TunnelWall's Shields sees an untrusted network or HomeNet a new device. */
  shieldPulse: boolean;
  /** A slow pulse while something waits in Inflow or Deputy. */
  waitingPulse: boolean;
  /** The count and up to three titles of what waits, on the always-on screen. */
  waitingAod: boolean;
  /** A small bubble with the count over other apps; a tap opens the app it came from. */
  bubble: boolean;
  /** Inflow's briefing lines on the always-on screen. */
  briefing: boolean;
  /** Also show private briefing lines (medicine, steps) and how many people are home. */
  briefingPrivate: boolean;
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
  aod: Aod;
  themes: Theme[]; // max 20; empty or missing gives the starter themes
  links: Links;
}

const FACE_OPTIONS: FaceOptions = { size: 'm', position: 'centre', h24: true, date: true, battery: true, alarm: false, seconds: false };
const theme = (t: Pick<Theme, 'id' | 'name' | 'face' | 'colours'> & Partial<Theme>): Theme => ({
  faceOptions: FACE_OPTIONS,
  photo: false,
  dim: 0.5,
  edge: { on: true, pattern: 'pulse-ring' },
  brightness: 0.02,
  ...t,
});

export const STARTER_THEMES: Theme[] = [
  theme({ id: 'night', name: 'Night', face: 'big-digits', colours: { source: 'wallpaper', palette: ['#FFFFFF'] }, edge: { on: false, pattern: 'pulse-ring' } }),
  theme({ id: 'pulse', name: 'Pulse', face: 'ring-analog', colours: { source: 'albumArt', palette: ['#22D3EE', '#A78BFA'] }, edge: { on: true, pattern: 'pulse-wave' } }),
  theme({ id: 'glass', name: 'Glass', face: 'stacked', colours: { source: 'palette', palette: ['#A78BFA', '#22D3EE'] }, edge: { on: false, pattern: 'pulse-ring' }, dim: 0.6 }),
  theme({ id: 'mono', name: 'Mono', face: 'minimal-line', colours: { source: 'palette', palette: ['#FFFFFF'] } }),
];

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
  aod: {
    enabled: false,
    timeoutSec: 30,
    trigger: 'always',
    schedule: { on: false, start: '00:00', end: '07:00' },
    themeId: 'night',
    slots: [],
    dots: { on: true, kinds: Object.fromEntries(DOT_KINDS.map((k) => [k, true])) as Record<DotKind, boolean>, count: true },
    chargeEffect: 'sweep',
    wakeOnCharge: true,
  },
  themes: STARTER_THEMES,
  links: { shieldPulse: false, waitingPulse: false, waitingAod: false, bubble: false, briefing: false, briefingPrivate: false },
};

const PKG = /^[a-zA-Z0-9_.]{1,200}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID = /^[a-z0-9-]{1,40}$/;
const MAX_APPS = 500;
const MAX_THEMES = 20;
const MAX_SLOTS = 4;
const TIMEOUTS = [10, 30, 60, 300, 900, 1800] as const;
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
        return [
          k,
          { on: bool(a.on, true), colour: typeof a.colour === 'string' && HEX.test(a.colour) ? a.colour.toUpperCase() : null, style: typeof a.style === 'string' && ID.test(a.style) ? a.style : null },
        ];
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

const id = (v: unknown): string | null => (typeof v === 'string' && ID.test(v) ? v : null);

function normalizeAod(raw: unknown): Aod {
  const d = DEFAULT_SETTINGS.aod;
  const a = obj(raw);
  const sc = obj(a.schedule);
  const dots = obj(a.dots);
  const kinds = obj(dots.kinds);
  const trigger = a.trigger === 'always' || a.trigger === 'charging' || a.trigger === 'music' ? a.trigger : d.trigger;
  const slots: Aod['slots'] = [];
  for (const e of Array.isArray(a.slots) ? a.slots : []) {
    const o = obj(e);
    const themeId = id(o.themeId);
    if (typeof o.start === 'string' && TIME.test(o.start) && themeId) slots.push({ start: o.start, themeId });
  }
  return {
    enabled: bool(a.enabled, d.enabled),
    // null (JSON null) means never stop; a missing or unknown value is the default.
    timeoutSec: a.timeoutSec === null ? null : (TIMEOUTS.find((t) => t === a.timeoutSec) ?? d.timeoutSec),
    trigger,
    schedule: { on: bool(sc.on, d.schedule.on), start: time(sc.start, d.schedule.start), end: time(sc.end, d.schedule.end) },
    themeId: id(a.themeId) ?? d.themeId,
    slots: slots.slice(0, MAX_SLOTS),
    dots: {
      on: bool(dots.on, d.dots.on),
      kinds: Object.fromEntries(DOT_KINDS.map((k) => [k, bool(kinds[k], true)])) as Record<DotKind, boolean>,
      count: bool(dots.count, d.dots.count),
    },
    chargeEffect: a.chargeEffect === 'off' || a.chargeEffect === 'sweep' ? a.chargeEffect : d.chargeEffect,
    wakeOnCharge: bool(a.wakeOnCharge, d.wakeOnCharge),
  };
}

/** 40 UTF-16 units like Kotlin take(40) and the RN maxLength; a cut that splits an emoji drops the lone high surrogate. Empty gives null. */
const cutName = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const cut = v.slice(0, 40).replace(/[\uD800-\uDBFF]$/, '');
  return cut === '' ? null : cut;
};

function normalizeTheme(raw: unknown): Theme | null {
  const t = obj(raw);
  const tid = id(t.id);
  if (!tid) return null;
  const f = obj(t.faceOptions);
  const c = obj(t.colours);
  const e = obj(t.edge);
  const palette = (Array.isArray(c.palette) ? c.palette : [])
    .filter((x): x is string => typeof x === 'string' && HEX.test(x))
    .slice(0, 4)
    .map((x) => x.toUpperCase());
  return {
    id: tid,
    name: cutName(t.name) ?? tid,
    face: id(t.face) ?? 'big-digits',
    faceOptions: {
      size: f.size === 's' || f.size === 'm' || f.size === 'l' ? f.size : FACE_OPTIONS.size,
      position: f.position === 'top' || f.position === 'centre' || f.position === 'bottom' ? f.position : FACE_OPTIONS.position,
      h24: bool(f.h24, FACE_OPTIONS.h24),
      date: bool(f.date, FACE_OPTIONS.date),
      battery: bool(f.battery, FACE_OPTIONS.battery),
      alarm: bool(f.alarm, FACE_OPTIONS.alarm),
      seconds: bool(f.seconds, FACE_OPTIONS.seconds),
    },
    colours: {
      source: c.source === 'palette' || c.source === 'albumArt' || c.source === 'wallpaper' ? c.source : 'palette',
      palette: palette.length > 0 ? palette : ['#FFFFFF'],
    },
    photo: bool(t.photo, false),
    dim: num(t.dim, 0.5, 0, 0.9),
    edge: { on: bool(e.on, true), pattern: id(e.pattern) ?? 'pulse-ring' },
    brightness: num(t.brightness, 0.02, 0.005, 0.3),
  };
}

/** A missing, empty or all-invalid list gives the starter themes; a repeated id keeps the first. */
function normalizeThemes(raw: unknown): Theme[] {
  const seen = new Set<string>();
  const out: Theme[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const t = normalizeTheme(r);
    if (t && !seen.has(t.id)) {
      seen.add(t.id);
      out.push(t);
    }
  }
  // JSON clone: structuredClone is not in Hermes, and callers must not alias the starter themes.
  return JSON.parse(JSON.stringify(out.length > 0 ? out.slice(0, MAX_THEMES) : STARTER_THEMES));
}

function normalizeLinks(raw: unknown): Links {
  const d = DEFAULT_SETTINGS.links;
  const l = obj(raw);
  return {
    shieldPulse: bool(l.shieldPulse, d.shieldPulse),
    waitingPulse: bool(l.waitingPulse, d.waitingPulse),
    waitingAod: bool(l.waitingAod, d.waitingAod),
    bubble: bool(l.bubble, d.bubble),
    briefing: bool(l.briefing, d.briefing),
    briefingPrivate: bool(l.briefingPrivate, d.briefingPrivate),
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
    aod: normalizeAod(r.aod),
    themes: normalizeThemes(r.themes),
    links: normalizeLinks(r.links),
  };
}
