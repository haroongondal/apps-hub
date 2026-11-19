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

/** Gemini embeds text and reads images; Groq answers questions, builds the graph and transcribes audio. */
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
  return { embed: g.embed, readImage: g.readImage, extract: q.extract, answer: q.answer, transcribe: q.transcribe };
}
