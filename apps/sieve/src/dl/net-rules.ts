export const ALLOW_RULE_ID = 1;
export const ALLOW_PRIORITY = 2_000_000_000;
export const REFERER_PRIORITY = 2_000_000_001;
export const RECORD_RULE_FIRST = 1000;
export const RECORD_RULE_LAST = 1999;
export const PROBE_RULE_FIRST = 900_000;

export function allowRule(extensionId: string): chrome.declarativeNetRequest.Rule {
  throw new Error('not implemented');
}
export function refererRule(id: number, url: string, referrer: string, extensionId: string): chrome.declarativeNetRequest.Rule {
  throw new Error('not implemented');
}
export function recordRules(records: readonly { id: string; url: string; finalUrl: string; referrer: string; state: string }[], extensionId: string): chrome.declarativeNetRequest.Rule[] {
  throw new Error('not implemented');
}
export async function installAllowRule(): Promise<void> {
  throw new Error('not implemented');
}
export async function syncRecordRules(extra?: readonly { url: string; finalUrl?: string; referrer: string }[]): Promise<void> {
  throw new Error('not implemented');
}
export async function addProbeRule(url: string, referrer: string): Promise<() => Promise<void>> {
  throw new Error('not implemented');
}
export function initNetRules(): void {
  throw new Error('not implemented');
}
