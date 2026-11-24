// The hub's JSON contract with no native import; fixtures/contract.json pins it to the hub's JVM tests.

export const API_VERSION = 2;
export const MAX_TEXTS = 8;

export type ErrorKind =
  | 'hub-missing'
  | 'not-allowed'
  | 'version'
  | 'no-key'
  | 'too-large'
  | 'invalid'
  | 'busy'
  | 'cancelled'
  | 'timeout'
  | 'provider-error';

export const ERROR_KINDS: readonly ErrorKind[] = [
  'hub-missing',
  'not-allowed',
  'version',
  'no-key',
  'too-large',
  'invalid',
  'busy',
  'cancelled',
  'timeout',
  'provider-error',
];

export function canFallBack(kind: ErrorKind): boolean {
  return kind === 'hub-missing' || kind === 'not-allowed' || kind === 'version' || kind === 'no-key';
}

export class AiHubError extends Error {
  kind: ErrorKind;
  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.name = 'AiHubError';
    this.kind = kind;
  }
}

export function errorFrom(e: unknown): AiHubError {
  if (e instanceof AiHubError) return e;
  const code = (e as { code?: unknown } | null)?.code;
  const kind = ERROR_KINDS.find((k) => k === code) ?? 'provider-error';
  const text = e instanceof Error ? e.message : String(e);
  const message = (text.split('Caused by: ').pop() ?? text).trim() || 'AI hub hit an unexpected error. Try again.';
  return new AiHubError(kind, message);
}

export type Priority = 'foreground' | 'background';
export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: Role;
  content?: string | Array<Record<string, unknown>> | null;
  tool_call_id?: string;
  tool_calls?: unknown[];
  [key: string]: unknown;
}

export interface ToolSpec {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

interface Common {
  priority?: Priority;
  requestId?: string;
}

export interface ChatRequest extends Common {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxTokens?: number;
}

export interface VisionRequest extends ChatRequest {
  image: string;
  mime: string;
}

export interface EmbedRequest {
  priority?: Priority;
  texts: string[];
  dimensions?: number;
}

export interface TranscribeRequest extends Common {
  file: string;
  fileName: string;
  mime: string;
  segments?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatReply {
  text: string | null;
  toolCalls: ToolCall[];
  usage: { inputTokens: number; cachedTokens: number; outputTokens: number };
  model: string;
}

export interface EmbedReply {
  vectors: Float32Array[];
  dims: number;
  model: string;
}

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface TranscribeReply {
  text: string;
  segments?: Segment[];
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function newRequestId(): string {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function idOf(requestId: string | undefined): string {
  const id = requestId ?? newRequestId();
  if (!ID.test(id)) throw new AiHubError('invalid', 'The requestId must be 1 to 64 letters, digits, - or _.');
  return id;
}

// A request that uses nothing newer goes out as apiVersion 1, so a hub that is not updated yet still serves it.
export function chatJson(job: 'chat' | 'vision', req: ChatRequest & { mime?: string }, requestId?: string): string {
  return JSON.stringify({
    apiVersion: 1,
    requestId: idOf(requestId ?? req.requestId),
    job,
    priority: req.priority ?? 'foreground',
    messages: req.messages,
    ...(req.tools ? { tools: req.tools } : {}),
    ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
    ...(job === 'vision' ? { mime: req.mime } : {}),
  });
}

export function embedJsons(req: EmbedRequest, ids: () => string = newRequestId): string[] {
  if (req.texts.length === 0) throw new AiHubError('invalid', 'Give at least one text to embed.');
  const out: string[] = [];
  for (let i = 0; i < req.texts.length; i += MAX_TEXTS) {
    out.push(
      JSON.stringify({
        apiVersion: req.dimensions === undefined ? 1 : 2,
        requestId: idOf(ids()),
        job: 'embed',
        priority: req.priority ?? 'background',
        texts: req.texts.slice(i, i + MAX_TEXTS),
        ...(req.dimensions !== undefined ? { dimensions: req.dimensions } : {}),
      }),
    );
  }
  return out;
}

export function transcribeJson(req: TranscribeRequest, requestId?: string): string {
  return JSON.stringify({
    apiVersion: req.segments ? 2 : 1,
    requestId: idOf(requestId ?? req.requestId),
    job: 'transcribe',
    priority: req.priority ?? 'foreground',
    fileName: req.fileName,
    mime: req.mime,
    ...(req.segments ? { segments: true } : {}),
  });
}

function unreadable(): AiHubError {
  return new AiHubError('provider-error', "AI hub sent a reply this app couldn't read. Update AI hub or this app.");
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function objectOf(json: string): Record<string, unknown> {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    throw unreadable();
  }
  if (!isObject(v)) throw unreadable();
  return v;
}

export function parseChat(json: string): ChatReply {
  const o = objectOf(json);
  if (typeof o.model !== 'string' || !Array.isArray(o.toolCalls)) throw unreadable();
  const usage = isObject(o.usage) ? o.usage : {};
  return {
    text: typeof o.text === 'string' ? o.text : null,
    toolCalls: o.toolCalls.filter(isObject).map((c) => ({
      id: typeof c.id === 'string' ? c.id : '',
      name: typeof c.name === 'string' ? c.name : '',
      args: isObject(c.args) ? c.args : {},
    })),
    usage: { inputTokens: num(usage.inputTokens), cachedTokens: num(usage.cachedTokens), outputTokens: num(usage.outputTokens) },
    model: o.model,
  };
}

export function decodeVector(b64: string): Float32Array {
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw unreadable();
  }
  if (bin.length % 4 !== 0) throw unreadable();
  const view = new DataView(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) view.setUint8(i, bin.charCodeAt(i));
  const out = new Float32Array(bin.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

export function parseEmbed(json: string, expected: number): EmbedReply {
  const o = objectOf(json);
  if (!Array.isArray(o.vectorsB64) || typeof o.model !== 'string' || o.vectorsB64.length !== expected) throw unreadable();
  const vectors = o.vectorsB64.map((v) => {
    if (typeof v !== 'string') throw unreadable();
    return decodeVector(v);
  });
  const dims = num(o.dims);
  if (vectors.some((v) => v.length !== dims)) throw unreadable();
  return { vectors, dims, model: o.model };
}

export function mergeEmbeds(parts: EmbedReply[]): EmbedReply {
  const first = parts[0];
  if (!first || parts.some((p) => p.dims !== first.dims)) throw unreadable();
  return { vectors: parts.flatMap((p) => p.vectors), dims: first.dims, model: first.model };
}

export function parseTranscribe(json: string, segments: boolean): TranscribeReply {
  const o = objectOf(json);
  if (typeof o.text !== 'string') throw unreadable();
  if (!segments) return { text: o.text };
  if (!Array.isArray(o.segments)) throw unreadable();
  return {
    text: o.text,
    segments: o.segments.map((s) => {
      if (!isObject(s) || typeof s.text !== 'string' || typeof s.start !== 'number' || typeof s.end !== 'number') throw unreadable();
      return { start: s.start, end: s.end, text: s.text };
    }),
  };
}
