import { nexusPort, type CompatPort } from '@apps-hub/knowledge-core';
import * as SecureStore from 'expo-secure-store';

// Gemini embeds text and reads images; Groq answers, builds the graph and transcribes. Both keys are needed.
export type Service = 'gemini' | 'groq';
const UPLOAD_MS = 10 * 60_000; // long enough to upload and transcribe a 25 MB recording
const TEXT_MS = 90_000; // short, so a hung service hands the call to the next key or service sooner

// Each service takes several keys: one that is refused or at its limit hands over to the next (knowledge-core openai.ts).
const keyName = (s: Service) => `${s}-api-keys`; // a JSON list
const oldKeyName = (s: Service) => `${s}-api-key`; // one key, before several were allowed
const cached: Partial<Record<Service, string[]>> = {};
let port: CompatPort | null = null;

export async function getKeys(s: Service): Promise<string[]> {
  if (cached[s] === undefined) {
    const saved = await SecureStore.getItemAsync(keyName(s));
    const old = saved === null ? await SecureStore.getItemAsync(oldKeyName(s)) : null;
    cached[s] = saved !== null ? (JSON.parse(saved) as unknown[]).filter((k): k is string => typeof k === 'string') : old ? [old] : [];
    port = null;
  }
  return cached[s] ?? [];
}

async function saveKeys(s: Service, keys: string[]): Promise<void> {
  if (keys.length) await SecureStore.setItemAsync(keyName(s), JSON.stringify(keys));
  else await SecureStore.deleteItemAsync(keyName(s));
  await SecureStore.deleteItemAsync(oldKeyName(s));
  cached[s] = keys;
  port = null;
}

export async function addKey(s: Service, key: string): Promise<void> {
  const keys = await getKeys(s);
  if (!keys.includes(key)) await saveKeys(s, [...keys, key]);
}

export async function removeKey(s: Service, index: number): Promise<void> {
  await saveKeys(s, (await getKeys(s)).filter((_, i) => i !== index));
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

// One port, so a key that took over stays in use; saveKeys builds a new one.
const current = () => (port ??= nexusPort({ gemini: cached.gemini ?? [], groq: cached.groq ?? [], fetch: timedFetch }));

export const ai: CompatPort = {
  embed: (texts) => current().embed(texts),
  extract: (segments) => current().extract(segments),
  answer: (question, sources) => current().answer(question, sources),
  readImage: (jpeg) => current().readImage(jpeg),
  transcribe: (file) => current().transcribe(file),
  complete: (system, user, json) => current().complete(system, user, json),
};
