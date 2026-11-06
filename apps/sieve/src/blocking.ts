// Deep imports keep the filter compiler (and its converter dependencies) out of the worker bundle.
import { blockingPlan, type BlockingPlan, type BuildMeta, type Registration } from '@apps-hub/sieve-core/src/plan.ts';
import { validateSettings } from '@apps-hub/sieve-core/src/settings.ts';
import type { DnrRule } from '@apps-hub/sieve-core/src/compile.ts';

type Script = chrome.scripting.RegisteredContentScript;

const canon = (v: unknown) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
// Chrome hands patterns back sorted and deduplicated.
const patterns = (p: string[] = []) => [...new Set(p)].sort();
const scriptShape = (s: Script) =>
  JSON.stringify([s.js ?? [], s.css ?? [], s.world ?? 'ISOLATED', patterns(s.matches), patterns(s.excludeMatches), s.allFrames ?? false, s.runAt ?? 'document_idle', s.persistAcrossSessions ?? true]);

async function applyRulesets(plan: BlockingPlan) {
  const enabled = new Set(await chrome.declarativeNetRequest.getEnabledRulesets());
  const enableRulesetIds = plan.enableRulesets.filter((id) => !enabled.has(id));
  const disableRulesetIds = plan.disableRulesets.filter((id) => enabled.has(id));
  if (enableRulesetIds.length || disableRulesetIds.length) await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
}

// One updateDynamicRules call, so Chrome keeps every earlier rule when it refuses any new one.
async function applyRules(rules: DnrRule[]) {
  const have = new Map((await chrome.declarativeNetRequest.getDynamicRules()).map((r) => [r.id, canon(r)]));
  const want = new Map(rules.map((r) => [r.id, canon(r)]));
  const removeRuleIds = [...have.keys()].filter((id) => have.get(id) !== want.get(id));
  const addRules = rules.filter((r) => have.get(r.id) !== want.get(r.id)) as unknown as chrome.declarativeNetRequest.Rule[];
  if (removeRuleIds.length || addRules.length) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

async function applyScripts(registrations: Registration[]) {
  const have = new Map((await chrome.scripting.getRegisteredContentScripts()).map((s) => [s.id, s]));
  // Chrome workaround: updateContentScripts resets persistAcrossSessions to false (seen in Chrome for Testing) when it is left out.
  const want = registrations.map((r) => ({ ...r, persistAcrossSessions: true }) as Script);
  const gone = [...have.keys()].filter((id) => !want.some((s) => s.id === id));
  const changed = want.filter((s) => have.has(s.id) && scriptShape(have.get(s.id) as Script) !== scriptShape(s));
  const added = want.filter((s) => !have.has(s.id));
  if (gone.length) await chrome.scripting.unregisterContentScripts({ ids: gone });
  if (changed.length) await chrome.scripting.updateContentScripts(changed);
  if (added.length) await chrome.scripting.registerContentScripts(added);
}

export async function applyBlocking(): Promise<void> {
  const errors: string[] = [];
  const attempt = async (step: () => Promise<void>) => {
    try {
      await step();
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  };
  await attempt(async () => {
    const [{ settings, myRules }, meta] = await Promise.all([
      chrome.storage.local.get(['settings', 'myRules']),
      fetch(chrome.runtime.getURL('meta.json')).then((r) => r.json() as Promise<BuildMeta>),
    ]);
    const plan = blockingPlan(validateSettings(settings), meta, Array.isArray(myRules) ? myRules : []);
    await Promise.all([attempt(() => applyRulesets(plan)), attempt(() => applyRules(plan.dynamicRules)), attempt(() => applyScripts(plan.registrations))]);
  });
  if (errors.length) await chrome.storage.session.set({ blockingError: { message: errors.join(' '), at: Date.now() } });
  else await chrome.storage.session.remove('blockingError');
}

let running: Promise<void> | null = null;
let again = false;

export function applyBlockingSoon(): void {
  if (running) {
    again = true;
    return;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await applyBlocking();
      } while (again);
    } finally {
      running = null;
    }
  })();
}
