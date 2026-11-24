import type { Complete } from '../cv/generate.ts';

// The CV maker's AI goes through the AI hub app (docs/ai-hub/PLAN.md, apiVersion 1), which holds the Gemini and
// Groq keys. The transport is injected so node --test runs this against a fake.
export interface HubTransport {
  submit(requestJson: string): Promise<string>;
  status(): Promise<string>;
}

export type HubStatus = { ok: true } | { ok: false; message: string };

const API_VERSION = 1;
const MAX_TOKENS = 8192; // the hub's cap: a reasoning model spends part of it thinking before it writes the CV
const newId = () => `cv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const messageOf = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

// The hub's chat has no JSON mode, so a model may wrap the object in a code fence or add a line of prose.
// shortcut: first "{" to last "}" is taken as the object; a reply with two objects fails to parse, which the CV reader reports.
export function jsonObjectIn(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

export function hubComplete(hub: HubTransport, makeId: () => string = newId): Complete {
  return async (system, user, json) => {
    const request = {
      apiVersion: API_VERSION,
      requestId: makeId(),
      job: 'chat',
      priority: 'foreground',
      maxTokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };
    const reply = await hub.submit(JSON.stringify(request));
    let text: unknown;
    try {
      text = (JSON.parse(reply) as { text?: unknown }).text;
    } catch {
      throw new Error('AI hub sent a reply Nexus could not read. Try again.');
    }
    if (typeof text !== 'string' || !text.trim()) throw new Error('AI hub sent no text. Try again.');
    return json ? jsonObjectIn(text) : text;
  };
}

/** Whether the hub can answer a chat now: installed, allowed for this app, and holding at least one key. */
export async function hubStatus(hub: HubTransport): Promise<HubStatus> {
  try {
    const status = JSON.parse(await hub.status()) as { services?: Record<string, { keys?: unknown }> };
    const keys = Object.values(status.services ?? {}).reduce((n, s) => n + (typeof s?.keys === 'number' ? s.keys : 0), 0);
    if (keys > 0) return { ok: true };
    return { ok: false, message: 'AI hub has no key yet. Open AI hub and add a Groq or Gemini key.' };
  } catch (err) {
    return { ok: false, message: messageOf(err, 'AI hub is not reachable.') };
  }
}
