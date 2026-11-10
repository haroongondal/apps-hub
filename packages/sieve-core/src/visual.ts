import { DEFAULT_YOUTUBE, type VideoFilters } from './youtube-settings.ts';

// Name, CSS function and unit, in the order the filter string lists them.
const FILTERS = [
  ['blur', 'blur', 'px'],
  ['brightness', 'brightness', '%'],
  ['contrast', 'contrast', '%'],
  ['grayscale', 'grayscale', '%'],
  ['hue', 'hue-rotate', 'deg'],
  ['invert', 'invert', '%'],
  ['saturate', 'saturate', '%'],
  ['sepia', 'sepia', '%'],
] as const;

export function filterCss(f: VideoFilters): string {
  const parts = FILTERS.filter(([key]) => f[key] !== DEFAULT_YOUTUBE.player.filters[key]).map(([key, fn, unit]) => `${fn}(${f[key]}${unit})`);
  return parts.length ? parts.join(' ') : 'none';
}

export function flipTransform(h: boolean, v: boolean): string {
  return h || v ? `scale(${h ? -1 : 1}, ${v ? -1 : 1})` : 'none';
}

// `hex` and `opacity` come validated from `validateYouTube`; a bad value still gives a usable backdrop.
export function backdropColor(hex: string, opacity: number): string {
  const [r, g, b] = /^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : [0, 0, 0];
  const a = Number.isFinite(opacity) ? Math.min(100, Math.max(0, opacity)) / 100 : DEFAULT_YOUTUBE.player.backdropOpacity / 100;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
