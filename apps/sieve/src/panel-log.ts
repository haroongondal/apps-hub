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
