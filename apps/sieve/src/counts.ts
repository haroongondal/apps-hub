import { brands } from '../../../packages/ui/src/tokens.ts';
import { DYNAMIC_RULESET, classifyMatch, countsKey, type Counts } from '@apps-hub/sieve-core/src/counts.ts';
import type { BuildMeta } from '@apps-hub/sieve-core/src/plan.ts';

let meta: Promise<BuildMeta> | undefined;
const loadMeta = () =>
  (meta ??= fetch(chrome.runtime.getURL('meta.json'))
    .then((r) => r.json() as Promise<BuildMeta>)
    .catch((e) => {
      meta = undefined;
      throw e;
    }));

// One queue for every write: events arrive in bursts, and two read-modify-writes at once would lose a count.
let queue: Promise<unknown> = Promise.resolve();
function later(work: () => Promise<unknown>): void {
  queue = queue.then(work).catch((e) => {
    if (!/No tab with id/i.test(e instanceof Error ? e.message : String(e))) console.error('Sieve could not update the blocked counts', e);
  });
}

// The badge API takes a literal colour, so it is the accent from the shared tokens; Chrome picks a readable text colour.
export function initBadge(): void {
  chrome.action.setBadgeBackgroundColor({ color: brands.sieve.accent.light });
}

const badgeText = (total: number) => (total === 0 ? '' : total > 999 ? '999+' : String(total));

async function dynamicAllowIds(rulesetId: string, ruleId: number): Promise<Set<number>> {
  if (rulesetId !== DYNAMIC_RULESET) return new Set();
  const rules = await chrome.declarativeNetRequest.getDynamicRules({ ruleIds: [ruleId] });
  return new Set(rules.filter((r) => r.action.type === 'allow' || r.action.type === 'allowAllRequests').map((r) => r.id));
}

export function onMatched({ request, rule }: chrome.declarativeNetRequest.MatchedRuleInfoDebug): void {
  const { tabId } = request;
  if (tabId < 0) return;
  later(async () => {
    const kind = classifyMatch(rule.rulesetId, rule.ruleId, await loadMeta(), await dynamicAllowIds(rule.rulesetId, rule.ruleId));
    if (kind === null) return;
    const key = countsKey(tabId);
    const counts: Counts = { ads: 0, trackers: 0, ...((await chrome.storage.session.get(key))[key] as Partial<Counts> | undefined) };
    if (kind === 'ad') counts.ads++;
    else counts.trackers++;
    // Badge first: a tab that closed meanwhile fails here, so it leaves no counts entry behind.
    await chrome.action.setBadgeText({ tabId, text: badgeText(counts.ads + counts.trackers) });
    await chrome.storage.session.set({ [key]: counts });
  });
}

export function onNavigated({ tabId, frameId }: chrome.webNavigation.WebNavigationTransitionCallbackDetails): void {
  if (frameId !== 0 || tabId < 0) return;
  later(() => Promise.all([chrome.storage.session.remove(countsKey(tabId)), chrome.action.setBadgeText({ tabId, text: '' })]));
}

export function onTabRemoved(tabId: number): void {
  later(() => chrome.storage.session.remove(countsKey(tabId)));
}
