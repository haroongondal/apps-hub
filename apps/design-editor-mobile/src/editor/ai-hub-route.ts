// Design with AI goes to AI hub first and to the app's own keys second. Pure: node --test runs it with a fake hub.
// The page's body is OpenAI-shaped (ai-layout.js); the hub takes {messages, tools, maxTokens} and answers {text, toolCalls}.
import { canFallBack, type ChatReply, type ChatRequest, type ErrorKind } from 'ai-hub-client/src/contract.ts';
import type { AiReply } from './ai-keys.ts';

export type AiSource = 'hub' | 'own' | 'none';
export type HubPort = { chat(req: ChatRequest): Promise<ChatReply> };

const MAX_JSON_BYTES = 512 * 1024;
const NOT_ALLOWED_MS = 10 * 60 * 1000; // an app is not asked to bind again for this long after the owner said no; a restart rechecks
// What the hub can honour. The hub picks the model and the reasoning effort, so reasoning_effort is a hint it drops;
// anything else (response_format, temperature, a forced tool, ...) cannot be carried over and goes to the own key.
const CARRIED = new Set(['messages', 'tools', 'tool_choice', 'max_completion_tokens', 'reasoning_effort']);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function utf8Bytes(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

const plainContent = (c: unknown) =>
  c === undefined || c === null || typeof c === 'string' || (Array.isArray(c) && c.every((p) => isObj(p) && p.type === 'text'));

/** The hub chat request for the page's body, or null when the hub cannot serve it. */
export function hubRequestFor(body: Record<string, unknown>): ChatRequest | null {
  if (Object.keys(body).some((k) => !CARRIED.has(k))) return null;
  if (body.tool_choice !== undefined && body.tool_choice !== 'auto') return null;
  const { messages, tools } = body;
  if (!Array.isArray(messages) || !messages.every((m) => isObj(m) && typeof m.role === 'string' && plainContent(m.content))) return null;
  const req: ChatRequest = { messages: messages as ChatRequest['messages'] };
  if (tools !== undefined) {
    if (!Array.isArray(tools)) return null;
    const specs = tools.map((t) => (isObj(t) && isObj(t.function) ? t.function : null));
    if (!specs.every((f) => f && typeof f.name === 'string' && isObj(f.parameters))) return null;
    req.tools = specs.map((f) => ({ name: f!.name as string, description: typeof f!.description === 'string' ? f!.description : '', parameters: f!.parameters as Record<string, unknown> }));
  }
  const asked = Number(body.max_completion_tokens);
  req.maxTokens = Math.min(Math.max(Math.floor(asked) || 8192, 1), 8192);
  return utf8Bytes(JSON.stringify(req)) > MAX_JSON_BYTES ? null : req;
}

/** The OpenAI `choices` reply the page reads. */
export function replyFromHub(r: ChatReply): AiReply {
  const message: Record<string, unknown> = { role: 'assistant', content: r.text ?? '' };
  if (r.toolCalls.length) {
    message.tool_calls = r.toolCalls.map((c, i) => ({ id: c.id || `call_${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }));
  }
  return { ok: true, status: 200, json: { choices: [{ index: 0, message, finish_reason: r.toolCalls.length ? 'tool_calls' : 'stop' }], model: r.model } };
}

/** For a failure that is not a fall-back: the page already words these statuses and errors. */
export function replyFromHubError(kind: ErrorKind): AiReply {
  if (kind === 'busy') return { ok: false, status: 429 };
  if (kind === 'timeout') return { ok: false, status: 0, error: 'timeout' };
  if (kind === 'provider-error') return { ok: false, status: 502 };
  return { ok: false, status: 0, error: 'bad' }; // too-large, invalid, cancelled
}

export function createAiRouter(deps: {
  hub: HubPort;
  own: (body: Record<string, unknown>) => Promise<AiReply>;
  record: (source: AiSource) => void;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  let notAllowedUntil = 0;

  async function viaOwn(body: Record<string, unknown>): Promise<AiReply> {
    const reply = await deps.own(body);
    if (reply.ok) deps.record('own');
    else if (reply.error === 'nokey') deps.record('none');
    return reply;
  }

  return async function route(body: Record<string, unknown>): Promise<AiReply> {
    const req = hubRequestFor(body);
    if (!req || now() < notAllowedUntil) return viaOwn(body);
    try {
      const reply = replyFromHub(await deps.hub.chat(req));
      deps.record('hub');
      return reply;
    } catch (e) {
      const kind = (e as { kind?: ErrorKind } | null)?.kind;
      if (!kind) return { ok: false, status: 0, error: 'bad' };
      if (!canFallBack(kind)) return replyFromHubError(kind);
      if (kind === 'not-allowed') notAllowedUntil = now() + NOT_ALLOWED_MS;
      return viaOwn(body);
    }
  };
}
