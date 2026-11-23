import {
  AiError,
  answerMessages,
  EMBED_DIMS,
  EMBED_MODEL,
  extractMessages,
  IMAGE_PROMPT,
  unit,
  type ChatText,
  type CompatPort,
  type Segment,
  type UploadFile,
} from '@apps-hub/knowledge-core';
import {
  canFallBack,
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

export interface Hub {
  chat(req: ChatRequest): Promise<ChatReply>;
  vision(req: VisionRequest): Promise<ChatReply>;
  embed(req: EmbedRequest): Promise<EmbedReply>;
  transcribe(req: TranscribeRequest): Promise<TranscribeReply>;
}

export type AiSource = 'hub' | 'own' | 'none';

export interface ImageFile {
  uri: string;
  size: number;
  base64(): Promise<string>;
}

export type NexusAi = Omit<CompatPort, 'readImage'> & { readImage(file: ImageFile): Promise<string> };

export interface HubFirstOptions {
  hub: Hub;
  own: () => CompatPort;
  now?: () => number;
  served?: (source: AiSource) => void;
}

export const HUB_MAX_IMAGE = 7 * 1024 * 1024;
export const HUB_MAX_TOKENS = 8192; // the hub's cap; its default of 2048 would cut a long graph or minutes reply
export const NOT_ALLOWED_MS = 10 * 60_000; // Nexus not switched on in AI hub: ask again after this, or on the next app start

// The hub answered, but another vector size or model would silently break search, so the own key serves the call.
class Unusable extends Error {}

const HUB_TO_AI: Record<ErrorKind, AiError['kind']> = {
  'hub-missing': 'server',
  'not-allowed': 'auth',
  version: 'server',
  'no-key': 'auth',
  'too-large': 'bad_request',
  invalid: 'bad_request',
  busy: 'rate',
  cancelled: 'server',
  timeout: 'server',
  'provider-error': 'server',
};

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

export function hubFirst({ hub, own, now = Date.now, served }: HubFirstOptions): NexusAi & { hubBlocked(): boolean } {
  let blockedUntil = 0;
  const hubBlocked = () => now() < blockedUntil;

  async function route<T>(viaHub: (() => Promise<T>) | null, viaOwn: () => Promise<T>): Promise<T> {
    if (viaHub && !hubBlocked()) {
      try {
        const out = await viaHub();
        served?.('hub');
        return out;
      } catch (e) {
        if (e instanceof AiError) throw e;
        if (!(e instanceof Unusable)) {
          const err = errorFrom(e);
          if (!canFallBack(err.kind)) throw new AiError(HUB_TO_AI[err.kind], err.message);
          if (err.kind === 'not-allowed') blockedUntil = now() + NOT_ALLOWED_MS;
        }
      }
    }
    const out = await viaOwn();
    served?.('own');
    return out;
  }

  const chat = (messages: ChatText[], priority?: 'background') =>
    hub.chat({ messages, maxTokens: HUB_MAX_TOKENS, ...(priority ? { priority } : {}) }).then(textOf);

  return {
    hubBlocked,

    embed: (texts) =>
      route(
        async () => {
          const reply = await hub.embed({ texts, dimensions: EMBED_DIMS });
          if (reply.dims !== EMBED_DIMS || reply.model !== EMBED_MODEL || reply.vectors.length !== texts.length) throw new Unusable();
          return reply.vectors.map(unit);
        },
        () => own().embed(texts),
      ),

    extract: (segments) =>
      route(
        async () => {
          const text = await chat(extractMessages(segments), 'background');
          try {
            return JSON.parse(jsonPart(text)) as unknown;
          } catch {
            throw new AiError('bad_reply', 'The AI service sent a graph Nexus could not read.');
          }
        },
        () => own().extract(segments),
      ),

    answer: (question, sources) =>
      route(
        () => chat(answerMessages(question, sources)),
        () => own().answer(question, sources),
      ),

    complete: (system, user, json) =>
      route(
        async () => {
          const text = await chat([
            { role: 'system', content: system },
            { role: 'user', content: user },
          ]);
          return json ? jsonPart(text) : text;
        },
        () => own().complete(system, user, json),
      ),

    readImage: (file) =>
      route(
        file.size > 0 && file.size <= HUB_MAX_IMAGE
          ? () => hub.vision({ messages: [{ role: 'user', content: IMAGE_PROMPT }], image: file.uri, mime: 'image/jpeg', maxTokens: HUB_MAX_TOKENS }).then(textOf)
          : null,
        async () => own().readImage(await file.base64()),
      ),

    transcribe: (file: UploadFile) =>
      route(
        'uri' in file
          ? async (): Promise<Segment[]> => {
              const reply = await hub.transcribe({ file: file.uri, fileName: file.name, mime: file.type, segments: true });
              return (reply.segments ?? []).map((s) => ({ text: s.text.trim(), locator: { startSec: s.start, endSec: s.end } }));
            }
          : null,
        () => own().transcribe(file),
      ),
  };
}
