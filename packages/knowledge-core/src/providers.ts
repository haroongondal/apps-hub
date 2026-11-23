import { AiError } from './types.ts';
import { EMBED_DIMS, openAiCompatPort, type CompatPort } from './openai.ts';

export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
export const GROQ_URL = 'https://api.groq.com/openai/v1/';
/** Stored beside the vectors: when it changes, Knowledge re-embeds every item. */
export const EMBED_TAG = `gemini-embedding-001@${EMBED_DIMS}`;
const GEMINI_CHAT = 'gemini-3.5-flash-lite';
const GROQ_CHAT = 'openai/gpt-oss-120b';
const NO_KEY = 'No API key is set. Add your key in AI settings.';

export interface NexusKeys {
  gemini: string[];
  groq: string[];
  fetch?: typeof fetch;
}

/** Each call tries its keys in order and hands on when one fails: chat tries Groq's, then Gemini's. */
export function nexusPort({ gemini, groq, fetch }: NexusKeys): CompatPort {
  const gem = gemini.filter((k) => k.trim()).map((apiKey) => openAiCompatPort({ apiKey, baseUrl: GEMINI_URL, embedModel: 'gemini-embedding-001', chatModel: GEMINI_CHAT, fetch }));
  const grq = groq
    .filter((k) => k.trim())
    .map((apiKey) =>
      openAiCompatPort({ apiKey, baseUrl: GROQ_URL, chatModel: GROQ_CHAT, reasoningEffort: 'low', transcribeModel: 'whisper-large-v3-turbo', fetch }),
    );
  const chat = [...grq, ...gem];
  return {
    embed: (texts) => firstOk(gem, (p) => p.embed(texts)),
    readImage: (jpeg) => firstOk(gem, (p) => p.readImage(jpeg)),
    transcribe: (file) => firstOk(grq, (p) => p.transcribe(file)),
    extract: (segments) => firstOk(chat, (p) => p.extract(segments)),
    answer: (question, sources) => firstOk(chat, (p) => p.answer(question, sources)),
    complete: (system, user, json) => firstOk(chat, (p) => p.complete(system, user, json)),
  };
}

async function firstOk<P, T>(ports: P[], run: (p: P) => Promise<T>): Promise<T> {
  let last: unknown = new AiError('auth', NO_KEY);
  for (const p of ports) {
    try {
      return await run(p);
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      last = err;
    }
  }
  throw last;
}
