import type { CosmeticSet, ScriptletCall } from './compile.ts';
import { hostCandidates } from './hosts.ts';

export interface PageInjection {
  css: string;
  scriptlets: ScriptletCall[];
}

// Here, not in compile.ts, so the service worker can import this file without the filter compiler.
export function scriptletKey(call: ScriptletCall): string {
  return JSON.stringify([call.name, ...call.args]);
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
