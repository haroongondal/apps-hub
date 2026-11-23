import { readAllRecords } from './idb-store.ts';

// inspected 2026-11-10, Chrome for Testing 149.0.7827.55 (probes p10, p11, p12), session rules for the engine's own requests:
// - F12: fetch from the Worker sends every cookie Chrome's own navigation sent, with only <all_urls> host permission.
// - F13: fetch cannot set Referer; a session modifyHeaders rule with initiatorDomains [extension id] does it, for the worker, the offscreen document and its Worker.
// - F14: Sieve's own blocking applies to the extension's fetches; an `allow` rule above meta.maxPriority lets them through, and the Referer rule must outrank it
//   (allow 2e9 with Referer 2e9+1 sets the header; the reverse order and equal priorities do not).
export const ALLOW_RULE_ID = 1;
export const ALLOW_PRIORITY = 2_000_000_000;
export const REFERER_PRIORITY = 2_000_000_001;
export const RECORD_RULE_FIRST = 1000;
export const RECORD_RULE_LAST = 1999;
export const PROBE_RULE_FIRST = 900_000;

const TYPES = ['xmlhttprequest', 'other'] as unknown as chrome.declarativeNetRequest.ResourceType[];
const dnr = () => chrome.declarativeNetRequest;

export function allowRule(extensionId: string): chrome.declarativeNetRequest.Rule {
  return { id: ALLOW_RULE_ID, priority: ALLOW_PRIORITY, action: { type: 'allow' }, condition: { initiatorDomains: [extensionId], resourceTypes: TYPES } } as unknown as chrome.declarativeNetRequest.Rule;
}

export function refererRule(id: number, url: string, referrer: string, extensionId: string): chrome.declarativeNetRequest.Rule {
  return {
    id,
    priority: REFERER_PRIORITY,
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'referer', operation: 'set', value: referrer }] },
    // shortcut: a URL with `*` or `^` is not matched exactly by a urlFilter, so that download goes without the Referer; escape them if it ever matters.
    condition: { urlFilter: '|' + url + '|', initiatorDomains: [extensionId], resourceTypes: TYPES },
  } as unknown as chrome.declarativeNetRequest.Rule;
}

// Chrome rejects a non-ASCII urlFilter and fails the whole batch, so such a download simply goes without the Referer.
const rulable = (...values: string[]) => values.every((v) => !/[^\x00-\x7f]/.test(v));

export function recordRules(records: readonly { id: string; url: string; finalUrl: string; referrer: string; state: string }[], extensionId: string): chrome.declarativeNetRequest.Rule[] {
  const rules: chrome.declarativeNetRequest.Rule[] = [];
  const sorted = records.filter((r) => r.state !== 'done' && r.referrer !== '').sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const r of sorted) {
    for (const url of r.finalUrl && r.finalUrl !== r.url ? [r.url, r.finalUrl] : [r.url]) {
      if (!rulable(url, r.referrer)) continue;
      if (RECORD_RULE_FIRST + rules.length > RECORD_RULE_LAST) return rules;
      rules.push(refererRule(RECORD_RULE_FIRST + rules.length, url, r.referrer, extensionId));
    }
  }
  return rules;
}

export async function installAllowRule(): Promise<void> {
  await dnr().updateSessionRules({ removeRuleIds: [ALLOW_RULE_ID], addRules: [allowRule(chrome.runtime.id)] });
}

type Extra = { url: string; finalUrl?: string; referrer: string };
// Adds that are waiting for the engine to persist their records: their rules stay until the caller drops them.
const pending: Extra[] = [];
let chain: Promise<unknown> = Promise.resolve();

async function sync(): Promise<void> {
  const records = await readAllRecords();
  const pseudo = pending.map((e, i) => ({ id: `~${i}`, url: e.url, finalUrl: e.finalUrl ?? e.url, referrer: e.referrer, state: 'queued' }));
  const rules = recordRules([...records, ...pseudo], chrome.runtime.id);
  const removeRuleIds = Array.from({ length: RECORD_RULE_LAST - RECORD_RULE_FIRST + 1 }, (_, i) => RECORD_RULE_FIRST + i);
  await dnr().updateSessionRules({ removeRuleIds, addRules: rules });
}

// One sync at a time, each built from the records plus every pending add, so an overlapping add never drops another's rule.
export function syncRecordRules(extra: readonly Extra[] = []): Promise<void> {
  pending.push(...extra);
  const run = chain.then(sync);
  chain = run.catch(() => {});
  return run;
}

export function dropPendingRules(extra: readonly Extra[]): void {
  for (const e of extra) {
    const i = pending.indexOf(e);
    if (i >= 0) pending.splice(i, 1);
  }
}

let probeCounter = 0;

export async function addProbeRule(url: string, referrer: string): Promise<() => Promise<void>> {
  if (referrer === '' || !rulable(url, referrer)) return async () => {};
  const id = PROBE_RULE_FIRST + (probeCounter++ % 1000);
  // Removing the id in the same call avoids a clash with a rule a dead worker left.
  await dnr().updateSessionRules({ removeRuleIds: [id], addRules: [refererRule(id, url, referrer, chrome.runtime.id)] });
  return async () => {
    await dnr().updateSessionRules({ removeRuleIds: [id] });
  };
}

export function initNetRules(): void {
  installAllowRule().catch((e) => console.error('Sieve: could not install the downloads allow rule', e));
}
