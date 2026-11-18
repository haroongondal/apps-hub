import * as FileSystem from 'expo-file-system/legacy';

// Design with AI on the phone (SPEC §14.3). The page never sees the key and never picks the URL or
// headers: it sends a request body, and this file adds the rest.
// shortcut: the key sits in an app-private file, not hardware-backed; upgrade to expo-secure-store if wanted.
const KEY_FILE = FileSystem.documentDirectory + 'ai-key.txt';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 60_000;

// Same shape as the desktop's reply (Task 3, ledger R2): HTTP errors carry status and no `error`.
export type AiReply = { ok: boolean; status: number; json?: object; error?: 'nokey' | 'offline' | 'timeout' | 'bad' };

async function readKey(): Promise<string | null> {
  const info = await FileSystem.getInfoAsync(KEY_FILE);
  if (!info.exists) return null;
  return (await FileSystem.readAsStringAsync(KEY_FILE)).trim() || null;
}

export async function aiHasKey(): Promise<boolean> {
  return (await readKey()) !== null;
}

export async function aiSetKey(key: unknown): Promise<true> {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) throw new Error('Enter an API key.');
  await FileSystem.writeAsStringAsync(KEY_FILE, trimmed);
  return true;
}

export async function aiRequest(body: unknown): Promise<AiReply> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, status: 0, error: 'bad' };
  const key = await readKey();
  if (!key) return { ok: false, status: 0, error: 'nokey' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    // the timer stays armed through the body read, so a stalled body also times out
    const text = await res.text();
    let json: object | undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) json = parsed;
    } catch {
      // not JSON
    }
    if (res.ok) return json ? { ok: true, status: res.status, json } : { ok: false, status: res.status, error: 'bad' };
    return json ? { ok: false, status: res.status, json } : { ok: false, status: res.status };
  } catch {
    return { ok: false, status: 0, error: ctl.signal.aborted ? 'timeout' : 'offline' };
  } finally {
    clearTimeout(timer);
  }
}
