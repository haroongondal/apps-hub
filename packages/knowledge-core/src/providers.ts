import { AiError } from './types.ts';
import { EMBED_DIMS, openAiCompatPort, type CompatPort } from './openai.ts';

export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
export const GROQ_URL = 'https://api.groq.com/openai/v1/';
/** Stored beside the vectors: when it changes, Knowledge re-embeds every item. */
export const EMBED_TAG = `gemini-embedding-001@${EMBED_DIMS}`;

/** Each service takes one key or several; a key that is refused or at its limit hands over to the next (openai.ts). */
export interface NexusKeys {
  gemini: string | string[];
  groq: string | string[];
  fetch?: typeof fetch;
}

export function nexusPort({ gemini, groq, fetch }: NexusKeys): CompatPort {
  const g = openAiCompatPort({ apiKey: gemini, baseUrl: GEMINI_URL, embedModel: 'gemini-embedding-001', chatModel: 'gemini-3.5-flash-lite', fetch });
  const q = openAiCompatPort({
    apiKey: groq,
    baseUrl: GROQ_URL,
    chatModel: 'openai/gpt-oss-120b',
    reasoningEffort: 'low',
    transcribeModel: 'whisper-large-v3-turbo',
    fetch,
  });
  const chat = [q, g];
  return {
    embed: g.embed,
    readImage: g.readImage,
    transcribe: q.transcribe,
    extract: (segments) => firstOk(chat, (p) => p.extract(segments)),
    answer: (question, sources) => firstOk(chat, (p) => p.answer(question, sources)),
    complete: (system, user, json) => firstOk(chat, (p) => p.complete(system, user, json)),
  };
}

async function firstOk<P, T>(ports: P[], run: (p: P) => Promise<T>): Promise<T> {
  let last: unknown = new AiError('auth', 'No API key is set. Add your key in AI settings.');
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
