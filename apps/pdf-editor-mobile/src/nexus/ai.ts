import { AiError } from '@apps-hub/knowledge-core';
import { API_VERSION } from 'ai-hub-client/src/contract.ts';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import { platformHub } from './hub-binding';
import { hubAi, type AiSource, type Hub, type NexusAi } from './hub-ai.ts';
import { hubGate, hubStateOf, type HubState } from './hub-state.ts';
import { oldKeyCleanup } from './old-keys.ts';

// Every AI call goes through AI hub (com.haroon.aihub). Nexus holds no key and has no AI provider of its own.

const missing = () => Promise.reject(new AiError('auth', 'AI hub runs on Android only.'));
const hub: Hub = platformHub ?? { chat: missing, vision: missing, embed: missing, transcribe: missing };

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

// A file in the app's own storage, like ai_source: the marker that a hub call has worked, so the old keys go on a later start too.
const worked = new File(Paths.document, 'hub_worked');
const oldKeys = oldKeyCleanup({
  remove: (name) => SecureStore.deleteItemAsync(name),
  marked: async () => worked.exists,
  mark: async () => worked.write('1'),
});
const warn = (err: unknown) => console.warn('Nexus could not remove its old keys', err);
void oldKeys.start().catch(warn);

const gate = hubGate({
  check: async () => {
    if (!platformHub) return 'missing';
    const found = await platformHub.available(API_VERSION);
    // A kind the owner cannot fix (a timeout) is left for the real call to report in plain words. Available alone never frees the old keys.
    return found.ok ? 'ready' : (hubStateOf(found.kind) ?? 'ready');
  },
});

function onState(state: HubState): void {
  gate.set(state);
  recordSource(state === 'ready' ? 'hub' : 'none');
}

export const hubState = async (): Promise<HubState> => {
  const state = await gate.state();
  if (state !== 'ready') recordSource('none');
  return state;
};

/** True when AI hub can take Nexus's calls; otherwise nothing leaves the phone. */
export const aiReady = async (): Promise<boolean> => (await hubState()) === 'ready';

/** The owner went to fix something in AI hub or the Store: look again. */
export const recheckHub = (): void => gate.forget();

export const ai: NexusAi = hubAi({ hub, onState, onWorked: () => void oldKeys.worked().catch(warn) });
