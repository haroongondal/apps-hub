import { openAiPort, type OpenAiPort } from '@apps-hub/knowledge-core';
import * as SecureStore from 'expo-secure-store';

const KEY = 'openai-api-key';
const TIMEOUT_MS = 10 * 60_000; // long enough to upload and transcribe a 25 MB recording

let cached: string | null | undefined;

export async function getApiKey(): Promise<string | null> {
  if (cached === undefined) cached = await SecureStore.getItemAsync(KEY);
  return cached;
}

export async function setApiKey(key: string | null): Promise<void> {
  if (key) await SecureStore.setItemAsync(KEY, key);
  else await SecureStore.deleteItemAsync(KEY);
  cached = key;
}

const timedFetch: typeof fetch = (input, init) => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  return fetch(input, { ...init, signal: abort.signal }).finally(() => clearTimeout(timer));
};

export const portFor = (apiKey: string) => openAiPort({ apiKey, fetch: timedFetch });

const current = () => portFor(cached ?? '');

export const ai: OpenAiPort = {
  embed: (texts) => current().embed(texts),
  extract: (segments) => current().extract(segments),
  answer: (question, sources) => current().answer(question, sources),
  readImage: (jpeg) => current().readImage(jpeg),
  transcribe: (file) => current().transcribe(file),
};
