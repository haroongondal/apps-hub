import { compileFilters } from '@apps-hub/sieve-core/src/compile.ts';
import { plainReason } from '@apps-hub/sieve-core/src/my-filters.ts';
import { blockingPlan, type BuildMeta } from '@apps-hub/sieve-core/src/plan.ts';
import { validateSettings } from '@apps-hub/sieve-core/src/settings.ts';
import { withSettingsLock } from './lock.ts';

export interface SaveResult {
  saved: number;
  errors: { line: number; text: string; reason: string }[];
  notSaved?: string; // why nothing was stored: Chrome's refusal, FILTERS_CHANGED or TOO_MANY_TO_STORE (also in errors, on line 0)
}

export const FILTERS_CHANGED = 'Your filters changed while Sieve was saving them. Save again to keep both.';
export const TOO_MANY_TO_STORE = "Sieve couldn't store this many filters. Remove some, then save again.";

const notSaved = (reason: string, errors: SaveResult['errors'] = []): SaveResult => ({ saved: 0, errors: [...errors, { line: 0, text: '', reason }], notSaved: reason });

export async function saveMyFilters(text: string, base?: string): Promise<SaveResult> {
  const meta = (await (await fetch(chrome.runtime.getURL('meta.json'))).json()) as BuildMeta;
  const compiled = await compileFilters(text, { firstId: 1, scriptlets: meta.scriptlets });
  const errors = [...compiled.errors, ...compiled.skipped].sort((a, b) => a.line - b.line).map((e) => ({ ...e, reason: plainReason(e.reason) }));
  // The lock covers the check, Chrome's rules and the write, not the slow compile: a pick or a switch waits only for those.
  return withSettingsLock(async () => {
    const s = validateSettings((await chrome.storage.local.get('settings')).settings);
    if (base !== undefined && s.blocking.myFilters !== base) return notSaved(FILTERS_CHANGED);
    // One atomic call with the unpaused plan's rules (allow rules too): a refusal leaves every earlier rule on; paused, they come off after.
    const { dynamicRules } = blockingPlan({ ...s, enabled: true, blocking: { ...s.blocking, paused: false } }, meta, compiled.rules);
    const previous = await chrome.declarativeNetRequest.getDynamicRules();
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: previous.map((r) => r.id), addRules: dynamicRules as unknown as chrome.declarativeNetRequest.Rule[] });
    } catch (e) {
      return notSaved(e instanceof Error ? e.message : String(e), errors);
    }
    try {
      await chrome.storage.local.set({
        settings: { ...s, blocking: { ...s.blocking, myFilters: text } },
        myRules: compiled.rules,
        myRuleSources: compiled.sources,
        myCosmetic: compiled.cosmetic,
      });
    } catch {
      // If putting the earlier rules back fails too, the answer is still "not saved": the worker's next apply sets Chrome's rules from storage, which still holds the earlier ones.
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: dynamicRules.map((r) => r.id), addRules: previous });
      } catch (e) {
        console.error('Sieve could not put the earlier My filters rules back', e);
      }
      return notSaved(TOO_MANY_TO_STORE, errors);
    }
    if (!s.enabled || s.blocking.paused) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: dynamicRules.map((r) => r.id) });
    return { saved: compiled.filterLines - new Set(errors.filter((e) => e.line > 0).map((e) => e.line)).size, errors };
  });
}
