// Pure and platform-free so node --test can run it. Mirrors core/Settings.kt; both read fixtures/settings.cases.json.
export type ColorSource = 'palette' | 'albumArt' | 'wallpaper';
export type Quad = [number, number, number, number];

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
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  enabled: true,
  pattern: 'pulse-ring',
  params: { thickness: 4, speed: 0.5, spread: 0.5, glow: 0.6, padding: 0, roundness: 1, mirrored: false, clockwise: true },
  colors: { source: 'albumArt', palette: ['#22D3EE', '#A78BFA'] },
  edges: { auto: true, corners: [0, 0, 0, 0], insets: [0, 0, 0, 0] },
};

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
  };
}
