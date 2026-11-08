import { compileFilters } from '@apps-hub/sieve-core/src/compile.ts';
import { plainReason } from '@apps-hub/sieve-core/src/my-filters.ts';
import { blockingPlan, type BuildMeta } from '@apps-hub/sieve-core/src/plan.ts';
import { validateSettings } from '@apps-hub/sieve-core/src/settings.ts';

export interface SaveResult {
  saved: number;
  errors: { line: number; text: string; reason: string }[];
}

export const FILTERS_CHANGED = 'Your filters changed while Sieve was saving them. Save again to keep both.';

const readSettings = async () => validateSettings((await chrome.storage.local.get('settings')).settings);

export async function saveMyFilters(text: string, base?: string): Promise<SaveResult> {
  const meta = (await (await fetch(chrome.runtime.getURL('meta.json'))).json()) as BuildMeta;
  const compiled = await compileFilters(text, { firstId: 1, trusted: true, scriptlets: meta.scriptlets });
  const errors = [...compiled.errors, ...compiled.skipped].sort((a, b) => a.line - b.line).map((e) => ({ ...e, reason: plainReason(e.reason) }));
  const before = await readSettings();
  if (base !== undefined && before.blocking.myFilters !== base) return { saved: 0, errors: [{ line: 0, text: '', reason: FILTERS_CHANGED }] };

  // One atomic call with the unpaused plan's rules (allow rules too): a refusal leaves every earlier rule on; paused, they come off after.
  const unpaused = { ...before, enabled: true, blocking: { ...before.blocking, paused: false } };
  const { dynamicRules } = blockingPlan(unpaused, meta, compiled.rules);
  try {
    const removeRuleIds = (await chrome.declarativeNetRequest.getDynamicRules()).map((r) => r.id);
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: dynamicRules as unknown as chrome.declarativeNetRequest.Rule[] });
  } catch (e) {
    return { saved: 0, errors: [...errors, { line: 0, text: '', reason: e instanceof Error ? e.message : String(e) }] };
  }
  // shortcut: a pick landing while Chrome takes the rules loses its line; both are one person's clicks. Use navigator.locks if that changes.
  const s = await readSettings();
  await chrome.storage.local.set({
    settings: { ...s, blocking: { ...s.blocking, myFilters: text } },
    myRules: compiled.rules,
    myRuleSources: compiled.sources,
    myCosmetic: compiled.cosmetic,
  });
  if (!s.enabled || s.blocking.paused) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: dynamicRules.map((r) => r.id) });
  return { saved: compiled.filterLines - new Set(errors.filter((e) => e.line > 0).map((e) => e.line)).size, errors };
}
