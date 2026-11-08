import type { CosmeticSet, ScriptletCall } from './compile.ts';
import { hostCandidates } from './hosts.ts';

export interface PageInjection {
  css: string;
  scriptlets: ScriptletCall[];
}

// Here, not in compile.ts, so the service worker can import this file without the filter compiler.
export function emptyCosmetic(): CosmeticSet {
  return { generic: [], hide: {}, unhide: {}, generichide: [], elemhide: [], scriptlets: {}, scriptletExcept: {} };
}

// My filters' set as storage holds it (`myCosmetic`): a missing or damaged field becomes an empty one, so one bad write cannot stop every page's injection.
export function storedCosmetic(raw: unknown): CosmeticSet {
  const stored = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const kind = (v: unknown, fallback: unknown) => (typeof v === 'object' && v !== null && Array.isArray(v) === Array.isArray(fallback) ? v : fallback);
  return Object.fromEntries(Object.entries(emptyCosmetic()).map(([key, fallback]) => [key, kind(stored[key], fallback)])) as unknown as CosmeticSet;
}

export function scriptletKey(call: ScriptletCall): string {
  return JSON.stringify([call.name, ...call.args]);
}

// What scriptlets.invoke passes to the function getScriptletFunction returns: the source object, then the args array, not spread.
export function scriptletArgs(call: ScriptletCall): [source: object, args: string[]] {
  return [{ name: call.name, args: call.args, engine: 'extension', verbose: false }, call.args];
}

// Exceptions (unhide, scriptletExcept) reach every set, so My filters can lift a list's rule; generichide and elemhide stay per set, like the registered stylesheets.
export function pageInjections(hostname: string, sets: CosmeticSet[], excluded: (set: number) => boolean): PageInjection {
  const keys = [...hostCandidates(hostname), '*'];
  const keySet = new Set(keys);
  const pick = <T>(map: Record<string, T[]>) => keys.flatMap((k) => (Object.hasOwn(map, k) ? map[k] : []));
  const matches = (hosts: string[]) => hosts.some((h) => keySet.has(h));
  const unhidden = new Set(sets.flatMap((s) => pick(s.unhide)));
  const except = new Set(sets.flatMap((s) => pick(s.scriptletExcept)));

  const selectors = new Set<string>();
  const scriptlets = new Map<string, ScriptletCall>();
  sets.forEach((set, i) => {
    if (matches(set.elemhide)) return;
    for (const s of pick(set.hide)) selectors.add(s);
    if (excluded(i) && !matches(set.generichide)) for (const s of set.generic) selectors.add(s);
    for (const call of pick(set.scriptlets)) scriptlets.set(scriptletKey(call), call);
  });

  return {
    css: [...selectors].filter((s) => !unhidden.has(s)).map((s) => `${s}{display:none!important}`).join('\n'),
    scriptlets: except.has('*') ? [] : [...scriptlets].filter(([key]) => !except.has(key)).map(([, call]) => call),
  };
}
