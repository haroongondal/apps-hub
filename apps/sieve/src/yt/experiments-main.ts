import { flagOverrides, patchFlags, patchSerialized, type FlagValue } from '@apps-hub/sieve-core/src/experiments.ts';
import { ytPage } from '@apps-hub/sieve-core/src/yt-bridge.ts';
import { feature, onSettings } from './bridge-main.ts';

// inspected 2026-11-11, signed out, Chrome for Testing 149.0.7827.55, no extension, dQw4w9WgXcQ: an inline script sets window.ytcfg at 0.6 s, then calls ytcfg.set({ EXPERIMENT_FLAGS (the object ytcfg.get returns), WEB_PLAYER_CONTEXT_CONFIGS (13 entries, each with a serializedExperimentFlags string of name=value& pairs), ... }) once at 0.7 s, before #movie_player exists; a second window.ytcfg object follows with no flags, and in-app navigations write no config again. The player first reads the string 0.1 to 1 s after that write and again while it builds; a patch made right after the write gives the old look, one at DOMContentLoaded, when #movie_player appears or 3 s in is too late.
// So the objects are kept and patched in place when the settings arrive and on every later write; a change made in the settings page applies from the next page load.
const configs = new Set<Record<string, unknown>>();
const flagSets = new Set<Record<string, unknown>>();
let overrides: Record<string, FlagValue> = {};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function patchAll(): void {
  if (Object.keys(overrides).length === 0) return;
  for (const flags of flagSets) patchFlags(flags, overrides);
  for (const config of configs) {
    const text = config.serializedExperimentFlags;
    if (typeof text !== 'string') continue;
    const next = patchSerialized(text, overrides);
    if (next !== text) config.serializedExperimentFlags = next;
  }
}

function keep(data: unknown): void {
  if (!isObject(data)) return;
  if (isObject(data.EXPERIMENT_FLAGS)) flagSets.add(data.EXPERIMENT_FLAGS);
  if (isObject(data.WEB_PLAYER_CONTEXT_CONFIGS)) for (const config of Object.values(data.WEB_PLAYER_CONTEXT_CONFIGS)) if (isObject(config)) configs.add(config);
  patchAll();
}

const apply = Reflect.apply;

function wrap(cfg: unknown): void {
  if (!isObject(cfg) || typeof cfg.set !== 'function') return;
  const set = cfg.set as (...a: unknown[]) => unknown;
  cfg.set = {
    set(_a: unknown, _b?: unknown) {
      try {
        keep(typeof arguments[0] === 'string' ? { [arguments[0]]: arguments[1] } : arguments[0]);
      } catch {}
      return apply(set, this, arguments);
    },
  }.set;
}

feature('experiments', () => {
  let current: unknown = (window as unknown as Record<string, unknown>).ytcfg;
  wrap(current);
  Object.defineProperty(window, 'ytcfg', {
    configurable: true,
    enumerable: true,
    get: () => current,
    set(value: unknown) {
      current = value;
      wrap(value);
    },
  });
});

onSettings((s) => {
  overrides = s.on && ytPage(location.href).kind !== 'other' ? flagOverrides(s.experiments) : {};
  patchAll();
});
