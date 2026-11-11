// Contract stub (Task 3.12): the real bodies land in the implementation commit.
export interface SaveEntry { id: string; size: number; path: string; chromeId: number | null; state: 'pending' | 'complete' | 'interrupted'; filename: string | null; error: string | null }

export function initSave(): void {}
export async function onSave(_message: unknown, _sender: chrome.runtime.MessageSender): Promise<{ ok: true; chromeId: number } | { ok: false; message: string }> {
  throw new Error('not implemented');
}
export async function recoverSaves(): Promise<void> {
  throw new Error('not implemented');
}
