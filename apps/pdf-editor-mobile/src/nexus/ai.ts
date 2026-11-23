import { nexusPort, type CompatPort } from '@apps-hub/knowledge-core';
import * as SecureStore from 'expo-secure-store';

// Gemini embeds text and reads images; Groq answers, builds the graph and transcribes. Both need a key.
export type Service = 'gemini' | 'groq';
const UPLOAD_MS = 10 * 60_000; // long enough to upload and transcribe a 25 MB recording
const TEXT_MS = 90_000; // short, so a hung service hands the call to the next key sooner

// Keys are tried in the order saved. The first build stored one key under `<service>-api-key`.
const listName = (s: Service) => `${s}-api-keys`;
const oldName = (s: Service) => `${s}-api-key`;
const cached: Partial<Record<Service, string[]>> = {};

export async function getKeys(s: Service): Promise<string[]> {
  if (!cached[s]) {
    const list = await SecureStore.getItemAsync(listName(s));
    const old = list ? null : await SecureStore.getItemAsync(oldName(s));
    cached[s] = list ? (JSON.parse(list) as string[]) : old ? [old] : [];
  }
  return cached[s];
}

export async function setKeys(s: Service, keys: string[]): Promise<void> {
  if (keys.length) await SecureStore.setItemAsync(listName(s), JSON.stringify(keys));
  else await SecureStore.deleteItemAsync(listName(s));
  await SecureStore.deleteItemAsync(oldName(s));
  cached[s] = keys;
}

export async function hasKeys(): Promise<boolean> {
  return (await getKeys('gemini')).length > 0 && (await getKeys('groq')).length > 0;
}

const timedFetch: typeof fetch = (input, init) => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), init?.body instanceof FormData ? UPLOAD_MS : TEXT_MS);
  return fetch(input, { ...init, signal: abort.signal }).finally(() => clearTimeout(timer));
};

/** Proves one key works before it is saved: an embedding for Gemini, a one-line answer for Groq. */
export async function checkKey(s: Service, key: string): Promise<void> {
  const port = nexusPort({ gemini: s === 'gemini' ? [key] : [], groq: s === 'groq' ? [key] : [], fetch: timedFetch });
  if (s === 'gemini') await port.embed(['Nexus key check']);
  else await port.answer('Nexus key check', ['Nexus key check']);
}

const current = async () => nexusPort({ gemini: await getKeys('gemini'), groq: await getKeys('groq'), fetch: timedFetch });

export const ai: CompatPort = {
  embed: async (texts) => (await current()).embed(texts),
  extract: async (segments) => (await current()).extract(segments),
  answer: async (question, sources) => (await current()).answer(question, sources),
  readImage: async (jpeg) => (await current()).readImage(jpeg),
  transcribe: async (file) => (await current()).transcribe(file),
  complete: async (system, user, json) => (await current()).complete(system, user, json),
};
