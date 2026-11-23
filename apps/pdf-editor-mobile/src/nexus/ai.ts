import { nexusPort, type CompatPort } from '@apps-hub/knowledge-core';
import { AiHubError, API_VERSION } from 'ai-hub-client/src/contract.ts';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import { platformHub } from './hub-binding';
import { hubFirst, type AiSource, type Hub, type NexusAi } from './hub-first';

// AI hub serves each call when it can (hub-first.ts). Otherwise Gemini embeds text and reads images; Groq answers, builds the graph and transcribes, so both keys are needed.
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

async function hasOwnKeys(): Promise<boolean> {
  return (await getKeys('gemini')).length > 0 && (await getKeys('groq')).length > 0;
}

const HUB_CHECK_MS = 60_000;
let hubCheck: { at: number; ok: boolean } | null = null;

async function hubReady(): Promise<boolean> {
  if (!platformHub || routed.hubBlocked()) return false;
  if (!hubCheck || Date.now() - hubCheck.at > HUB_CHECK_MS) hubCheck = { at: Date.now(), ok: (await platformHub.available(API_VERSION)).ok };
  return hubCheck.ok;
}

/** True when AI hub can take Nexus's calls or both own keys are saved; otherwise nothing leaves the phone. */
export async function aiReady(): Promise<boolean> {
  const ready = (await hasOwnKeys()) || (await hubReady());
  if (!ready) recordSource('none');
  return ready;
}

let lastSource: AiSource | null = null;
function recordSource(source: AiSource): void {
  if (source === lastSource) return;
  lastSource = source;
  try {
    new File(Paths.document, 'ai_source').write(source);
  } catch (err) {
    console.warn('Nexus could not record ai_source', err);
  }
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

const missing = () => Promise.reject(new AiHubError('hub-missing', 'AI hub runs on Android only.'));
const hub: Hub = platformHub ?? { chat: missing, vision: missing, embed: missing, transcribe: missing };
const routed = hubFirst({ hub, own: current, served: recordSource });

export const ai: NexusAi = routed;
