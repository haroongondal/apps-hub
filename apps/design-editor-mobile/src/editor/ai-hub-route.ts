// Design with AI goes to AI hub and nowhere else: this app holds no provider key. Pure: node --test runs it with a fake hub.
// The page's body is OpenAI-shaped (ai-layout.js); the hub takes {messages, tools, maxTokens} and answers {text, toolCalls}.
import type { ChatReply, ChatRequest, ErrorKind } from 'ai-hub-client/src/contract.ts';

// error: what the page words itself. hubmissing, notallowed and nokey are the three AI hub states with a button; the rest are plain failures.
export type AiReply = { ok: boolean; status: number; json?: object; error?: 'hubmissing' | 'notallowed' | 'nokey' | 'timeout' | 'bad' };
export type AiSource = 'hub' | 'none'; // who answered last, for the Store's health row
export type HubPort = { chat(req: ChatRequest): Promise<ChatReply> };

const MAX_JSON_BYTES = 512 * 1024;
// What the hub can honour. The hub picks the model and the reasoning effort, so reasoning_effort is a hint it drops;
// anything else (response_format, temperature, a forced tool, ...) is refused: the page only ever sends the layout request.
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

/** The page already words these statuses and errors; the three hub states carry a button. No hub error text reaches the page. */
export function replyFromHubError(kind: ErrorKind): AiReply {
  if (kind === 'hub-missing' || kind === 'version') return { ok: false, status: 0, error: 'hubmissing' };
  if (kind === 'not-allowed') return { ok: false, status: 0, error: 'notallowed' };
  if (kind === 'no-key') return { ok: false, status: 0, error: 'nokey' };
  if (kind === 'busy') return { ok: false, status: 429 };
  if (kind === 'timeout') return { ok: false, status: 0, error: 'timeout' };
  if (kind === 'provider-error') return { ok: false, status: 502 };
  return { ok: false, status: 0, error: 'bad' }; // too-large, invalid, cancelled
}

const HUB_STATES = new Set(['hubmissing', 'notallowed', 'nokey']);

export function createAiRouter(deps: { hub: HubPort; record: (source: AiSource) => void }) {
  return async function route(body: Record<string, unknown>): Promise<AiReply> {
    const req = hubRequestFor(body);
    if (!req) return { ok: false, status: 0, error: 'bad' };
    try {
      const reply = replyFromHub(await deps.hub.chat(req));
      deps.record('hub');
      return reply;
    } catch (e) {
      const kind = (e as { kind?: ErrorKind } | null)?.kind;
      if (!kind) return { ok: false, status: 0, error: 'bad' };
      const reply = replyFromHubError(kind);
      if (reply.error && HUB_STATES.has(reply.error)) deps.record('none');
      return reply;
    }
  };
}
