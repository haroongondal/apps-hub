import { DYNAMIC_RULESET } from '@apps-hub/sieve-core/src/counts.ts';
import type { FeatureKey } from '@apps-hub/sieve-core/src/settings.ts';
import { NAMES } from './lists.ts';

export interface Row {
  at: number;
  type: string;
  url: string;
  list: string;
  filter: string;
}

export const MAX_ROWS = 500;

export const listName = (rulesetId: string): string => (rulesetId === DYNAMIC_RULESET ? 'My filters' : Object.hasOwn(NAMES, rulesetId) ? NAMES[rulesetId as FeatureKey] : rulesetId);

// Keeps the newest MAX_ROWS rows, and says whether it dropped older ones.
export function addRow(rows: Row[], row: Row): boolean {
  rows.push(row);
  if (rows.length <= MAX_ROWS) return false;
  rows.splice(0, rows.length - MAX_ROWS);
  return true;
}

export const HEALTHY_MS = 5000;
export const MAX_QUICK_DROPS = 5;

// A port that lived HEALTHY_MS or delivered a message was a good one (Chrome just stopped the idle worker), so the panel connects again at once.
// Ports that drop right away mean the worker can't start: wait longer each time, and give up (null) after MAX_QUICK_DROPS in a row.
export function afterDrop(quickDrops: number, livedMs: number, received: boolean): { quickDrops: number; retryMs: number | null } {
  const quick = received || livedMs >= HEALTHY_MS ? 0 : quickDrops + 1;
  return { quickDrops: quick, retryMs: quick >= MAX_QUICK_DROPS ? null : quick === 0 ? 0 : Math.min(250 * 2 ** (quick - 1), 2000) };
}

export function filterSources(load: (rulesetId: string) => Promise<Record<string, string>>) {
  const loaded = new Map<string, Promise<Record<string, string>>>();
  return {
    forget: (rulesetId: string): void => void loaded.delete(rulesetId),
    async get(rulesetId: string, ruleId: number): Promise<string> {
      let sources = loaded.get(rulesetId);
      if (!sources) loaded.set(rulesetId, (sources = load(rulesetId)));
      try {
        return (await sources)[ruleId] ?? '';
      } catch (e) {
        loaded.delete(rulesetId);
        console.error(`Sieve could not read the filter text of ${rulesetId}`, e);
        return '';
      }
    },
  };
}
