export const ACCENTS = ['indigo', 'cyan', 'mint', 'amber', 'rose', 'violet', 'sky', 'lime'] as const;
export const PILLS = ['black', 'graphite', 'tinted'] as const;
export const SIZES = ['compact', 'regular', 'large'] as const;
export const CORNERS = ['pill', 'rounded', 'squared'] as const;
export const FOLDS = [3000, 5000, 10000, 0] as const;
export const CLOCKS = ['12', '24', 'system'] as const;
export const WIDGETS = ['clock', 'battery', 'timer', 'media'] as const;

export type Accent = (typeof ACCENTS)[number];
export type PillColour = (typeof PILLS)[number];
export type Size = (typeof SIZES)[number];
export type Corners = (typeof CORNERS)[number];
export type Clock = (typeof CLOCKS)[number];
export type WidgetId = (typeof WIDGETS)[number];

export interface NotchSettings {
  accent: Accent;
  pill: PillColour;
  size: Size;
  corners: Corners;
  /** Milliseconds before the card folds back; 0 means never. */
  foldMs: number;
  clock: Clock;
  widgets: WidgetId[];
}

export const DEFAULTS: NotchSettings = {
  accent: 'indigo',
  pill: 'black',
  size: 'regular',
  corners: 'pill',
  foldMs: 5000,
  clock: 'system',
  widgets: ['clock', 'battery'],
};

// Each swatch must reach WCAG AA (4.5:1) on the black and graphite pills; settings.test.ts checks it.
export const SWATCHES: Record<Accent, string> = {
  indigo: '#818CF8',
  cyan: '#22D3EE',
  mint: '#34D399',
  amber: '#FBBF24',
  rose: '#FB7185',
  violet: '#C084FC',
  sky: '#38BDF8',
  lime: '#A3E635',
};

function pick<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

export function normalize(raw: unknown): NotchSettings {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(o.widgets) ? o.widgets : DEFAULTS.widgets;
  const widgets: WidgetId[] = [];
  for (const id of list) {
    if ((WIDGETS as readonly unknown[]).includes(id) && !widgets.includes(id as WidgetId)) widgets.push(id as WidgetId);
  }
  return {
    accent: pick(o.accent, ACCENTS, DEFAULTS.accent),
    pill: pick(o.pill, PILLS, DEFAULTS.pill),
    size: pick(o.size, SIZES, DEFAULTS.size),
    corners: pick(o.corners, CORNERS, DEFAULTS.corners),
    foldMs: pick(o.foldMs, FOLDS, DEFAULTS.foldMs),
    clock: pick(o.clock, CLOCKS, DEFAULTS.clock),
    widgets,
  };
}

export function moveWidget(list: WidgetId[], id: WidgetId, to: number): WidgetId[] {
  const rest = list.filter((w) => w !== id);
  const at = Math.max(0, Math.min(to, rest.length));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

export function foldLabel(foldMs: number): string {
  if (foldMs === 0) return 'Never';
  return `${foldMs / 1000} seconds`;
}

// Same rule as the native card: the accent is mixed into black at 20%, each channel truncated.
export function pillHex(pill: PillColour, accent: Accent): string {
  if (pill === 'graphite') return '#1C1C1E';
  if (pill === 'black') return '#000000';
  const hex = SWATCHES[accent];
  const channel = (i: number) => Math.trunc(parseInt(hex.slice(i, i + 2), 16) * 0.2);
  return '#' + [1, 3, 5].map((i) => channel(i).toString(16).padStart(2, '0').toUpperCase()).join('');
}

export function clockLabel(hour24: number, minute: number, clock: '12' | '24'): string {
  const m = String(minute).padStart(2, '0');
  if (clock === '24') return `${String(hour24).padStart(2, '0')}:${m}`;
  return `${hour24 % 12 || 12}:${m}`;
}

// 'system' follows the phone's own 12/24-hour setting.
export function resolveClock(clock: Clock): '12' | '24' {
  if (clock !== 'system') return clock;
  const hour12 = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12;
  return hour12 ? '12' : '24';
}

// Same rule as earLayout() in EarLayout.kt.
export function earPlan(widgets: WidgetId[]): { time: boolean; battery: boolean; dateLine: boolean } {
  const clock = widgets.includes('clock');
  return { time: clock, battery: widgets.includes('battery'), dateLine: clock };
}
