import { FEATURES } from './settings.ts';
import type { BuildMeta } from './plan.ts';

export interface Counts {
  ads: number;
  trackers: number;
}

export const countsKey = (tabId: number) => `counts:${tabId}`;

export const DYNAMIC_RULESET = '_dynamic';

// Rule ids restart at 1 in each list, so a static id is only an allow rule in its own list.
export function classifyMatch(rulesetId: string, ruleId: number, meta: BuildMeta, dynamicAllowIds: ReadonlySet<number>): 'ad' | 'tracker' | null {
  const allow =
    rulesetId === DYNAMIC_RULESET ? dynamicAllowIds.has(ruleId) : FEATURES.some((f) => meta.features[f].ruleset === rulesetId && meta.features[f].allowIds.includes(ruleId));
  if (allow) return null;
  return rulesetId === 'trackers' ? 'tracker' : 'ad';
}
