// Pure TS so the RN theme and the generated web/tokens.css share one source of truth.

export type Scheme = 'light' | 'dark';
export type BrandKey = 'netlens' | 'opentunnel' | 'store' | 'pdf' | 'design';
export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';

export interface Palette {
  bg: string;
  surface: string;
  raised: string;
  line: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  onAccent: string;
  accentSoft: string;
  ok: string;
  warn: string;
  danger: string;
  okSoft: string;
  warnSoft: string;
  dangerSoft: string;
}

interface Brand {
  name: string;
  hue: number;
  accent: Record<Scheme, string>;
  onAccent: Record<Scheme, string>;
}

export const brands: Record<BrandKey, Brand> = {
  netlens: { name: 'NetLens', hue: 214, accent: { dark: '#7DD3FC', light: '#0369A1' }, onAccent: { dark: '#062033', light: '#FFFFFF' } },
  opentunnel: { name: 'OpenTunnel', hue: 158, accent: { dark: '#34D399', light: '#047857' }, onAccent: { dark: '#04261A', light: '#FFFFFF' } },
  store: { name: 'Store', hue: 250, accent: { dark: '#F6B73C', light: '#8A5300' }, onAccent: { dark: '#2A1A00', light: '#FFFFFF' } },
  pdf: { name: 'PDF Editor', hue: 345, accent: { dark: '#FF6B6B', light: '#C42B2B' }, onAccent: { dark: '#2B0707', light: '#FFFFFF' } },
  design: { name: 'Design Editor', hue: 268, accent: { dark: '#B79CFF', light: '#5B34D6' }, onAccent: { dark: '#1C0E40', light: '#FFFFFF' } },
};

export function hsl(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

export function alpha(hex: string, a: number): string {
  return hex + Math.round(a * 255).toString(16).padStart(2, '0').toUpperCase();
}

const semantic = {
  dark: { ok: '#4ADE80', warn: '#FBBF24', danger: '#F87171' },
  light: { ok: '#15803D', warn: '#8F5600', danger: '#B91C1C' },
} as const;

export function palette(brand: BrandKey, scheme: Scheme): Palette {
  const { hue, accent, onAccent } = brands[brand];
  const s = semantic[scheme];
  const soft = scheme === 'dark' ? 0.16 : 0.1;
  // `muted` must stay >= 4.5:1 on `bg` (tokens.test.ts); `faint` is for disabled/decorative text only.
  const base =
    scheme === 'dark'
      ? { bg: hsl(hue, 38, 7), surface: hsl(hue, 30, 11), raised: hsl(hue, 26, 16), line: hsl(hue, 20, 23), text: hsl(hue, 30, 96), muted: hsl(hue, 14, 72), faint: hsl(hue, 10, 50) }
      : { bg: hsl(hue, 24, 96), surface: '#FFFFFF', raised: hsl(hue, 22, 92), line: hsl(hue, 16, 85), text: hsl(hue, 40, 11), muted: hsl(hue, 12, 36), faint: hsl(hue, 8, 55) };
  return {
    ...base,
    accent: accent[scheme],
    onAccent: onAccent[scheme],
    accentSoft: alpha(accent[scheme], soft),
    ...s,
    okSoft: alpha(s.ok, soft),
    warnSoft: alpha(s.warn, soft),
    dangerSoft: alpha(s.danger, soft),
  };
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = { control: 10, group: 16, sheet: 24, pill: 999 } as const;

export const fonts = {
  regular: 'AtkinsonHyperlegibleNext_400Regular',
  semibold: 'AtkinsonHyperlegibleNext_600SemiBold',
  heavy: 'AtkinsonHyperlegibleNext_800ExtraBold',
  mono: 'AtkinsonHyperlegibleMono_400Regular',
  monoSemibold: 'AtkinsonHyperlegibleMono_600SemiBold',
} as const;

export type TypeVariant = 'display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'meta' | 'caption' | 'readout' | 'data';

export const type: Record<TypeVariant, { font: keyof typeof fonts; size: number; lineHeight: number; letterSpacing?: number }> = {
  display: { font: 'heavy', size: 34, lineHeight: 40, letterSpacing: -0.6 },
  title: { font: 'heavy', size: 26, lineHeight: 32, letterSpacing: -0.3 },
  heading: { font: 'semibold', size: 19, lineHeight: 25 },
  body: { font: 'regular', size: 16, lineHeight: 23 },
  bodyStrong: { font: 'semibold', size: 16, lineHeight: 23 },
  meta: { font: 'regular', size: 14, lineHeight: 20 },
  caption: { font: 'semibold', size: 12.5, lineHeight: 16, letterSpacing: 0.2 },
  readout: { font: 'monoSemibold', size: 40, lineHeight: 44, letterSpacing: -1 },
  data: { font: 'mono', size: 14, lineHeight: 20 },
};

export const touch = 48;
