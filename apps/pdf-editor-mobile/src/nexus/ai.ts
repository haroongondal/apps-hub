import { nexusPort, type CompatPort } from '@apps-hub/knowledge-core';
import * as SecureStore from 'expo-secure-store';

// Gemini embeds text and reads images; Groq answers, builds the graph and transcribes. Both keys are needed.
export type Service = 'gemini' | 'groq';
const TIMEOUT_MS = 10 * 60_000; // long enough to upload and transcribe a 25 MB recording

const keyName = (s: Service) => `${s}-api-key`;
const cached: Partial<Record<Service, string | null>> = {};

export async function getKey(s: Service): Promise<string | null> {
  if (cached[s] === undefined) cached[s] = await SecureStore.getItemAsync(keyName(s));
  return cached[s] ?? null;
}

export async function setKey(s: Service, key: string | null): Promise<void> {
  if (key) await SecureStore.setItemAsync(keyName(s), key);
  else await SecureStore.deleteItemAsync(keyName(s));
  cached[s] = key;
}

export async function hasKeys(): Promise<boolean> {
  return !!(await getKey('gemini')) && !!(await getKey('groq'));
}

const timedFetch: typeof fetch = (input, init) => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  return fetch(input, { ...init, signal: abort.signal }).finally(() => clearTimeout(timer));
};

/** Proves one key works before it is saved: an embedding for Gemini, a one-line answer for Groq. */
export async function checkKey(s: Service, key: string): Promise<void> {
  const port = nexusPort({ gemini: s === 'gemini' ? key : '', groq: s === 'groq' ? key : '', fetch: timedFetch });
  if (s === 'gemini') await port.embed(['Nexus key check']);
  else await port.answer('Nexus key check', ['Nexus key check']);
}

const current = () => nexusPort({ gemini: cached.gemini ?? '', groq: cached.groq ?? '', fetch: timedFetch });

export const ai: CompatPort = {
  embed: (texts) => current().embed(texts),
  extract: (segments) => current().extract(segments),
  answer: (question, sources) => current().answer(question, sources),
  readImage: (jpeg) => current().readImage(jpeg),
  transcribe: (file) => current().transcribe(file),
};
