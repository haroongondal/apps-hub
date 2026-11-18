import * as FileSystem from 'expo-file-system/legacy';

// Design with AI on the phone (SPEC §14.3). The page never sees the key and never picks the URL or
// headers: it sends a request body, and this file adds the rest.
// shortcut: the key sits in an app-private file, not hardware-backed; upgrade to expo-secure-store if wanted.
const KEY_FILE = FileSystem.documentDirectory + 'ai-key.txt';
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
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

// Same reply as the Mac's ai-set-key (ledger R6): { ok, error? }. A write that fails still rejects; the bridge turns that into a replyError.
export async function aiSetKey(key: unknown): Promise<{ ok: boolean; error?: 'nosecure' | 'bad' }> {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) return { ok: false, error: 'bad' };
  await FileSystem.writeAsStringAsync(KEY_FILE, trimmed);
  return { ok: true };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
// The page picks the prompt and the tool, not the model, the spend or a server tool. Keep this in step with aiSanitise in apps/design-editor/main.js.
const AI_MODEL = 'openai/gpt-oss-120b'; // keep in step with MODEL in packages/design-editor-engine/ai-layout.js
function aiSanitise(body: unknown): Record<string, unknown> | null {
  if (!isObj(body) || !Array.isArray(body.messages)) return null;
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.some((t) => !isObj(t) || t.type !== 'function' || !isObj(t.function)))) return null;
  const clean: Record<string, unknown> = { ...body, model: AI_MODEL, max_completion_tokens: Math.min(Number(body.max_completion_tokens) || 8000, 8000) };
  delete clean.stream;
  return clean;
}

export async function aiRequest(page: unknown): Promise<AiReply> {
  const body = aiSanitise(page);
  if (!body) return { ok: false, status: 0, error: 'bad' };
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // a storage failure answers 'nokey' and never rejects with a file path in the message
    const key = await readKey().catch(() => null);
    if (!key) return { ok: false, status: 0, error: 'nokey' };
    timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const res = await fetch(ENDPOINT, {
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
    if (timer) clearTimeout(timer);
  }
}
