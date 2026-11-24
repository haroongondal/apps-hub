import * as FileSystem from 'expo-file-system/legacy';
import { aiHub } from 'ai-hub-client';
import { createAiRouter, type AiReply, type AiSource } from './ai-hub-route.ts';
import { afterHubReply, onStart, type OldKeyDeps } from './old-keys.ts';

// Design with AI on the phone (SPEC §14.3). The page never picks the URL, the model or a header: it sends a request
// body and this file hands it to AI hub, which holds the keys. This app has no key of its own.
const SOURCE_FILE = FileSystem.documentDirectory + 'ai-source.txt'; // 'hub' | 'none': who served the last call, for the health row
const OLD_KEYS_FILE = FileSystem.documentDirectory + 'ai-keys.json'; // saved by builds before AI hub only
const OLD_KEY_FILE = FileSystem.documentDirectory + 'ai-key.txt'; // one Groq key, before several were allowed
const WORKED_FILE = FileSystem.documentDirectory + 'ai-hub-worked.txt'; // exists once AI hub has returned a real reply on this phone

export type { AiReply };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
// The page picks the prompt and the tool, not the model, the spend or a server tool. Keep this in step with aiSanitise in apps/design-editor/main.js.
function aiSanitise(body: unknown): Record<string, unknown> | null {
  if (!isObj(body) || !Array.isArray(body.messages)) return null;
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.some((t) => !isObj(t) || t.type !== 'function' || !isObj(t.function)))) return null;
  const { model: _model, stream: _stream, ...clean } = body; // the hub picks the model
  return { ...clean, max_completion_tokens: Math.min(Number(body.max_completion_tokens) || 8000, 8000) };
}

// shortcut: a failed write is dropped, the health row only reads a hint; upgrade when that row shows more.
const recordSource = (source: AiSource) => void FileSystem.writeAsStringAsync(SOURCE_FILE, source).catch(() => {});

const oldKeys: OldKeyDeps = {
  markerExists: async () => (await FileSystem.getInfoAsync(WORKED_FILE)).exists,
  writeMarker: () => FileSystem.writeAsStringAsync(WORKED_FILE, '1'),
  deleteKeyFiles: async () => {
    await FileSystem.deleteAsync(OLD_KEYS_FILE, { idempotent: true });
    await FileSystem.deleteAsync(OLD_KEY_FILE, { idempotent: true });
  },
};

// 'hub' is written only here, on a real reply: the Store's health row must not say the hub serves this app before it has.
const route = createAiRouter({ hub: aiHub, record: recordSource, served: () => void afterHubReply(oldKeys).catch(() => {}) });

export async function aiRequest(page: unknown): Promise<AiReply> {
  const body = aiSanitise(page);
  if (!body) return { ok: false, status: 0, error: 'bad' };
  return route(body);
}

// Asking once on start puts this app in the hub's Apps list ("Asked to use AI. Allow?"), even before anyone taps Generate.
// It also resets the health row to none (a served reply sets it to hub again), and finishes clearing the keys saved before AI hub only once a real reply has come (old-keys.ts).
export function aiHubWarmUp(): void {
  void (async () => {
    await aiHub.available().catch(() => {});
    recordSource('none');
    await onStart(oldKeys);
  })().catch(() => {});
}
