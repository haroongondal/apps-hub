import { FEATURES } from './settings.ts';
import type { BuildMeta } from './plan.ts';

export interface Counts {
  ads: number;
  trackers: number;
}

export const countsKey = (tabId: number) => `counts:${tabId}`;

export const DYNAMIC_RULESET = '_dynamic';

// A redirect with a transform ($removeparam) only rewrites the address, and the request still goes through.
export const blocksRequest = (action: { type: string; redirect?: object }) => action.type === 'block' || (action.type === 'redirect' && !(action.redirect && 'transform' in action.redirect));

// Rule ids restart at 1 in each list, so a static id is only an allow or header-only rule in its own list.
export function classifyMatch(rulesetId: string, ruleId: number, meta: BuildMeta, dynamicNotBlocking: ReadonlySet<number>): 'ad' | 'tracker' | null {
  const notABlock =
    rulesetId === DYNAMIC_RULESET
      ? dynamicNotBlocking.has(ruleId)
      : FEATURES.some((f) => meta.features[f].ruleset === rulesetId && (meta.features[f].allowIds.includes(ruleId) || meta.features[f].modifyIds.includes(ruleId)));
  if (notABlock) return null;
  return rulesetId === 'trackers' ? 'tracker' : 'ad';
}
