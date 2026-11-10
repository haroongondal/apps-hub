import type { AddItem } from '@apps-hub/sieve-core/src/dl-record.ts';

export const ENGINE_PAGE = 'offscreen.html';

export async function engineExists(): Promise<boolean> {
  throw new Error('not implemented');
}
export async function ensureEngine(): Promise<void> {
  throw new Error('not implemented');
}
export async function closeEngine(): Promise<void> {
  throw new Error('not implemented');
}
export async function sendToEngine<T = unknown>(_message: { type: `dl-eng-${string}` } & Record<string, unknown>): Promise<T> {
  throw new Error('not implemented');
}
export async function addRecords(_items: AddItem[]): Promise<{ ids: string[] } | null> {
  throw new Error('not implemented');
}
export function fromExtensionPage(_sender: chrome.runtime.MessageSender): boolean {
  throw new Error('not implemented');
}
