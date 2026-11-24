import { requireNativeModule } from 'expo-modules-core';
import {
  AiHubError,
  chatJson,
  embedJsons,
  errorFrom,
  mergeEmbeds,
  parseChat,
  parseEmbed,
  parseTranscribe,
  transcribeJson,
  type ChatReply,
  type ChatRequest,
  type EmbedReply,
  type EmbedRequest,
  type ErrorKind,
  type TranscribeReply,
  type TranscribeRequest,
  type VisionRequest,
} from './contract.ts';

export * from './contract.ts';

interface AiHubClientApi {
  hubVersion(): Promise<number>;
  submit(requestJson: string, attachmentPath: string | null): Promise<string>;
  cancel(requestId: string): Promise<void>;
}

const native = requireNativeModule<AiHubClientApi>('AiHubClient');

export type Availability = { ok: true; version: number } | { ok: false; kind: ErrorKind; message: string };

async function submit(json: string, file: string | null): Promise<string> {
  try {
    const reply = await native.submit(json, file);
    if (typeof reply !== 'string') throw new AiHubError('provider-error', "AI hub sent a reply this app couldn't read.");
    return reply;
  } catch (e) {
    throw errorFrom(e);
  }
}

export const aiHub = {
  async available(need = 1): Promise<Availability> {
    try {
      const version = await native.hubVersion();
      if (typeof version !== 'number' || version < need) {
        return { ok: false, kind: 'version', message: 'This needs a newer AI hub. Update AI hub from the Store.' };
      }
      return { ok: true, version };
    } catch (e) {
      const err = errorFrom(e);
      return { ok: false, kind: err.kind, message: err.message };
    }
  },

  async chat(req: ChatRequest): Promise<ChatReply> {
    return parseChat(await submit(chatJson('chat', req), null));
  },

  async vision(req: VisionRequest): Promise<ChatReply> {
    return parseChat(await submit(chatJson('vision', req), req.image));
  },

  async embed(req: EmbedRequest): Promise<EmbedReply> {
    const parts: EmbedReply[] = [];
    for (const json of embedJsons(req)) {
      const count = (JSON.parse(json) as { texts: string[] }).texts.length;
      parts.push(parseEmbed(await submit(json, null), count));
    }
    return mergeEmbeds(parts);
  },

  async transcribe(req: TranscribeRequest): Promise<TranscribeReply> {
    return parseTranscribe(await submit(transcribeJson(req), req.file), req.segments === true);
  },

  async cancel(requestId: string): Promise<void> {
    await native.cancel(requestId);
  },
};
