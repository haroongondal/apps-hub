import type { YouTubeSettings } from './youtube-settings.ts';

export type FlagValue = boolean | number | string;

// inspected 2026-11-11, signed out, Chrome for Testing 149.0.7827.55: the player reads these from its serializedExperimentFlags string; each removes a ytp-delhi-* class on #movie_player (modern-player removes all of them). Page-level flags (web_watch_rounded_player_large, kevlar_watch_metadata_refresh) changed nothing visible, so they have no preset. Full list: __tests__/fixtures/yt/experiment-flags.json.
export const EXPERIMENT_PRESETS: readonly { id: string; label: string; flags: Record<string, FlagValue> }[] = [
  { id: 'modern-player', label: 'the modern player', flags: { delhi_modern_web_player: false } },
  { id: 'modern-icons', label: 'the modern player icons', flags: { delhi_modern_web_player_icons: false } },
  { id: 'modern-volume', label: 'the horizontal volume slider', flags: { delhi_modern_web_player_horizontal_volume_controls: false } },
];

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
// An own property even for a name like __proto__.
const put = (o: Record<string, unknown>, k: string, v: unknown): void => void Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });

const NAME = /^[A-Za-z0-9_]+$/;
const NUMBER = /^-?(\d+\.?\d*|\.\d+)$/;

export function parseFlagOverrides(text: string): { flags: Record<string, FlagValue>; errors: { line: number; reason: string }[] } {
  const flags: Record<string, FlagValue> = {};
  const errors: { line: number; reason: string }[] = [];
  String(text).split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    const name = eq < 0 ? '' : line.slice(0, eq).trim();
    const value = eq < 0 ? '' : line.slice(eq + 1).trim();
    if (eq < 0 || value === '') errors.push({ line: i + 1, reason: 'Write it as name=value.' });
    else if (!NAME.test(name)) errors.push({ line: i + 1, reason: 'Flag names use letters, digits and underscores.' });
    else if (value.includes('&')) errors.push({ line: i + 1, reason: 'Values cannot contain &.' });
    else put(flags, name, value === 'true' ? true : value === 'false' ? false : NUMBER.test(value) && Number.isFinite(Number(value)) ? Number(value) : value);
  });
  return { flags, errors };
}

export function flagOverrides(e: YouTubeSettings['experiments']): Record<string, FlagValue> {
  const out: Record<string, FlagValue> = {};
  for (const id of e.presets) for (const [k, v] of Object.entries(EXPERIMENT_PRESETS.find((p) => p.id === id)?.flags ?? {})) put(out, k, v);
  for (const [k, v] of Object.entries(parseFlagOverrides(e.overrides).flags)) put(out, k, v);
  return out;
}

export function patchFlags(flags: Record<string, unknown>, overrides: Record<string, FlagValue>): boolean {
  let changed = false;
  for (const [k, v] of Object.entries(overrides)) {
    if (has(flags, k) && flags[k] === v) continue;
    put(flags, k, v);
    changed = true;
  }
  return changed;
}

export function patchSerialized(serialized: string, overrides: Record<string, FlagValue>): string {
  const left = new Set(Object.keys(overrides));
  const out = (serialized === '' ? [] : serialized.split('&')).map((part) => {
    const eq = part.indexOf('=');
    const k = eq < 0 ? '' : part.slice(0, eq);
    if (eq < 0 || !has(overrides, k)) return part;
    left.delete(k);
    return `${k}=${overrides[k]}`;
  });
  for (const k of left) out.push(`${k}=${overrides[k]}`);
  return out.join('&');
}
