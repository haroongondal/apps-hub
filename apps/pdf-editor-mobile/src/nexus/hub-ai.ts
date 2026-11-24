import {
  AiError,
  answerMessages,
  EMBED_DIMS,
  EMBED_MODEL,
  extractMessages,
  IMAGE_PROMPT,
  unit,
  type AiPort,
  type ChatText,
  type Segment,
} from '@apps-hub/knowledge-core';
import {
  errorFrom,
  type ChatReply,
  type ChatRequest,
  type EmbedReply,
  type EmbedRequest,
  type ErrorKind,
  type TranscribeReply,
  type TranscribeRequest,
  type VisionRequest,
} from 'ai-hub-client/src/contract.ts';

import { HUB_COPY, hubStateOf, WAITING_LINE, type HubState } from './hub-state.ts';

export interface Hub {
  chat(req: ChatRequest): Promise<ChatReply>;
  vision(req: VisionRequest): Promise<ChatReply>;
  embed(req: EmbedRequest): Promise<EmbedReply>;
  transcribe(req: TranscribeRequest): Promise<TranscribeReply>;
}

export type AiSource = 'hub' | 'none';

export interface ImageFile {
  uri: string;
  size: number;
}

export interface AudioFile {
  uri: string;
  name: string;
  type: string;
}

export interface NexusAi extends AiPort {
  transcribe(file: AudioFile): Promise<Segment[]>;
  readImage(file: ImageFile): Promise<string>;
  /** One chat turn for other features (the CV maker, minutes). `json` asks for one JSON object. */
  complete(system: string, user: string, json: boolean): Promise<string>;
}

export const HUB_MAX_IMAGE = 7 * 1024 * 1024;
export const HUB_MAX_TOKENS = 8192; // the hub's cap; its default of 2048 would cut a long graph or minutes reply

// What the owner sees. The hub's own wording and error kinds never reach a screen.
const PLAIN: Partial<Record<ErrorKind, AiError>> = {
  busy: new AiError('rate', 'AI hub is busy. Nexus tries again in a moment.'),
  // The hub reports an offline phone as provider-error, so the two cannot be told apart. 'offline' is a pausing kind: the queue waits and tries again later without using up an attempt.
  timeout: new AiError('offline', WAITING_LINE),
  'provider-error': new AiError('offline', WAITING_LINE),
  cancelled: new AiError('server', 'The request was stopped. Nexus tries again.'),
  'too-large': new AiError('bad_request', 'That is too big for the AI service to take at once.'),
  invalid: new AiError('bad_request', "Nexus sent a request the AI service couldn't use."),
};

// 'auth' pauses the queue without using up an attempt: the owner has to act, and retrying will not help.
export function toAiError(e: unknown, onState?: (state: HubState) => void): AiError {
  if (e instanceof AiError) return e;
  const kind = errorFrom(e).kind;
  const state = hubStateOf(kind);
  if (state) {
    onState?.(state);
    return new AiError('auth', HUB_COPY[state].title);
  }
  const plain = PLAIN[kind];
  return new AiError(plain?.kind ?? 'server', plain?.message ?? 'The AI service had a problem. Nexus tries again.');
}

// The hub has no JSON mode, so a model may wrap the object in a code fence or a sentence.
export const jsonPart = (text: string): string => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
};

function textOf(reply: ChatReply): string {
  if (typeof reply.text !== 'string') throw new AiError('bad_reply', 'The AI service sent an empty reply.');
  return reply.text;
}

export interface HubAiOptions {
  hub: Hub;
  /** AI hub answered ('ready') or said what the owner has to do. */
  onState?: (state: HubState) => void;
  /** A chat or embed returned a real result: AI hub holds a key and works for Nexus. */
  onWorked?: () => void;
}

export function hubAi({ hub, onState, onWorked }: HubAiOptions): NexusAi {
  async function run<T>(call: () => Promise<T>): Promise<T> {
    try {
      const out = await call();
      onState?.('ready');
      return out;
    } catch (e) {
      throw toAiError(e, onState);
    }
  }

  const chat = (messages: ChatText[], priority?: 'background') =>
    hub.chat({ messages, maxTokens: HUB_MAX_TOKENS, ...(priority ? { priority } : {}) }).then(textOf).then((text) => {
      if (text.trim() !== '') onWorked?.();
      return text;
    });

  return {
    embed: (texts) =>
      run(async () => {
        const reply = await hub.embed({ texts, dimensions: EMBED_DIMS });
        // Another vector size or model would silently break search; the owner chooses the model in AI hub, so this waits for them instead of failing the item.
        if (reply.dims !== EMBED_DIMS || reply.model !== EMBED_MODEL || reply.vectors.length !== texts.length) {
          throw new AiError('auth', 'AI hub is using another Embeddings model. In AI hub, set Embeddings to gemini-embedding-001.');
        }
        if (reply.vectors.length > 0) onWorked?.();
        return reply.vectors.map(unit);
      }),

    extract: (segments) =>
      run(async () => {
        const text = await chat(extractMessages(segments), 'background');
        try {
          return JSON.parse(jsonPart(text)) as unknown;
        } catch {
          throw new AiError('bad_reply', 'The AI service sent a graph Nexus could not read.');
        }
      }),

    answer: (question, sources) => run(() => chat(answerMessages(question, sources))),

    complete: (system, user, json) =>
      run(async () => {
        const text = await chat([
          { role: 'system', content: system },
          { role: 'user', content: user },
        ]);
        return json ? jsonPart(text) : text;
      }),

    readImage: (file) =>
      run(async () => {
        if (file.size > HUB_MAX_IMAGE) throw new AiError('bad_request', 'That photo is too large to read. Use a smaller one.');
        return hub.vision({ messages: [{ role: 'user', content: IMAGE_PROMPT }], image: file.uri, mime: 'image/jpeg', maxTokens: HUB_MAX_TOKENS }).then(textOf);
      }),

    transcribe: (file) =>
      run(async (): Promise<Segment[]> => {
        const reply = await hub.transcribe({ file: file.uri, fileName: file.name, mime: file.type, segments: true });
        return (reply.segments ?? []).map((s) => ({ text: s.text.trim(), locator: { startSec: s.start, endSec: s.end } }));
      }),
  };
}
