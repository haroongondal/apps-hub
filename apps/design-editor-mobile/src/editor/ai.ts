import * as FileSystem from 'expo-file-system/legacy';
import { aiHub } from 'ai-hub-client';
import { createAiRouter, type AiSource } from './ai-hub-route.ts';
import { createSender, labelOf, serviceOf, type AiReply } from './ai-keys.ts';

// Design with AI on the phone (SPEC §14.3). The page never sees a key and never picks the URL or
// headers: it sends a request body, and this file adds the rest. Groq and Gemini keys can be mixed;
// a key that is refused or at its limit hands over to the next one (ai-keys.ts).
// shortcut: the keys sit in an app-private file, not hardware-backed; upgrade to expo-secure-store if wanted.
const KEYS_FILE = FileSystem.documentDirectory + 'ai-keys.json';
const SOURCE_FILE = FileSystem.documentDirectory + 'ai-source.txt'; // 'hub' | 'own' | 'none': who served the last call, for the health row
const OLD_KEY_FILE = FileSystem.documentDirectory + 'ai-key.txt'; // one Groq key, before several were allowed
const TIMEOUT_MS = 60_000;

export type { AiReply };

async function readText(file: string): Promise<string | null> {
  const info = await FileSystem.getInfoAsync(file);
  return info.exists ? FileSystem.readAsStringAsync(file) : null;
}

async function readKeys(): Promise<string[]> {
  try {
    const saved = await readText(KEYS_FILE);
    if (saved !== null) return (JSON.parse(saved) as unknown[]).filter((k): k is string => typeof k === 'string' && serviceOf(k) !== null);
    const old = (await readText(OLD_KEY_FILE))?.trim();
    return old && serviceOf(old) ? [old] : [];
  } catch {
    return []; // a storage failure answers "no key" and never rejects with a file path in the message
  }
}

// A write that fails still rejects; the bridge turns that into a replyError.
async function writeKeys(keys: string[]): Promise<void> {
  await FileSystem.writeAsStringAsync(KEYS_FILE, JSON.stringify(keys));
  await FileSystem.deleteAsync(OLD_KEY_FILE, { idempotent: true });
}

export async function aiHasKey(): Promise<boolean> {
  return (await readKeys()).length > 0;
}

export async function aiKeys(): Promise<string[]> {
  return (await readKeys()).map(labelOf);
}

// Same reply as the Mac's ai-set-key: { ok, error? }. Saving adds a key; the same key twice is kept once.
export async function aiSetKey(key: unknown): Promise<{ ok: boolean; error?: 'nosecure' | 'bad' | 'badkey' }> {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) return { ok: false, error: 'bad' };
  if (!serviceOf(trimmed)) return { ok: false, error: 'badkey' };
  const keys = await readKeys();
  if (!keys.includes(trimmed)) await writeKeys([...keys, trimmed]);
  return { ok: true };
}

export async function aiRemoveKey(index: unknown): Promise<{ ok: boolean }> {
  const keys = await readKeys();
  if (Number.isInteger(index) && keys[index as number] !== undefined) await writeKeys(keys.filter((_, i) => i !== index));
  return { ok: true };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
// The page picks the prompt and the tool, not the model, the spend or a server tool. Keep this in step with aiSanitise in apps/design-editor/main.js.
function aiSanitise(body: unknown): Record<string, unknown> | null {
  if (!isObj(body) || !Array.isArray(body.messages)) return null;
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.some((t) => !isObj(t) || t.type !== 'function' || !isObj(t.function)))) return null;
  const { model: _model, stream: _stream, ...clean } = body; // the model comes from the key's service (ai-keys.ts)
  return { ...clean, max_completion_tokens: Math.min(Number(body.max_completion_tokens) || 8000, 8000) };
}

async function postToService(url: string, key: string, body: Record<string, unknown>): Promise<AiReply> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
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

const send = createSender();

// shortcut: a failed write is dropped, the health row only reads a hint; upgrade when that row shows more.
const recordSource = (source: AiSource) => void FileSystem.writeAsStringAsync(SOURCE_FILE, source).catch(() => {});

async function ownRequest(body: Record<string, unknown>): Promise<AiReply> {
  return send(await readKeys(), body, postToService);
}

const route = createAiRouter({ hub: aiHub, own: ownRequest, record: recordSource });

// AI hub first, the keys above second (ai-hub-route.ts). Image generation does not exist in this app, so no call stays on Gemini images.
export async function aiRequest(page: unknown): Promise<AiReply> {
  const body = aiSanitise(page);
  if (!body) return { ok: false, status: 0, error: 'bad' };
  return route(body);
}

// Asking once on start puts this app in the hub's Apps list ("Asked to use AI. Allow?"), even before anyone taps Generate.
export function aiHubWarmUp(): void {
  void aiHub.available().catch(() => {});
}
