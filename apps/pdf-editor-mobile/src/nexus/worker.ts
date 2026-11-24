import { EMBED_TAG, Knowledge } from '@apps-hub/knowledge-core';
import { AppState } from 'react-native';

import { newId } from '../library/ids';
import { openLibrary } from '../library/open-library';

import { ai, aiReady, recheckHub } from './ai';
import { content } from './content';

const WORKERS = 3;

let opening: Promise<Knowledge> | null = null;
let running = 0;
let turn: Promise<void> = Promise.resolve();
// kick and recover take turns, so no worker of ours can claim a job while recover runs.
const inTurn = (step: () => Promise<void>) => (turn = turn.then(step, step));
const listeners = new Set<() => void>();

export function openKnowledge(): Promise<Knowledge> {
  if (!opening) {
    opening = openLibrary().then((lib) => Knowledge.open(lib, { ai, content, embedTag: EMBED_TAG, now: Date.now, newId }));
    opening.catch(() => {
      opening = null;
    });
  }
  return opening;
}

export function onQueueChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const emit = () => listeners.forEach((l) => l());

async function work(kn: Knowledge) {
  try {
    // Stops on idle, on a pause (AI hub needs the owner, offline, rate limit) and when the app leaves the foreground.
    while ((await kn.runNext()) === 'ran' && AppState.currentState === 'active') emit();
  } catch (err) {
    console.warn('Nexus worker stopped', err);
  } finally {
    running--;
    emit();
  }
}

/** Without AI hub ready nothing leaves the phone: queued items wait until it is. */
export function kick(): Promise<void> {
  return inTurn(async () => {
    if (!(await aiReady())) return emit();
    const kn = await openKnowledge();
    while (running < WORKERS) {
      running++;
      void work(kn);
    }
  });
}

export async function enqueue(itemId: string): Promise<void> {
  await (await openKnowledge()).enqueue(itemId);
  await kick();
}

export async function keepOut(itemId: string): Promise<void> {
  await (await openKnowledge()).exclude(itemId);
  emit();
}

export async function takeBack(itemId: string): Promise<void> {
  await (await openKnowledge()).include(itemId);
  emit();
  await kick();
}

export function startWorker(): () => void {
  const resume = async () => {
    recheckHub(); // the owner may have installed, allowed or added a key in AI hub while Nexus was away
    try {
      // With none of our workers running, every 'running' row belongs to a dead process.
      await inTurn(async () => {
        if (running === 0) await (await openKnowledge()).recover(0);
      });
      await kick();
    } catch (err) {
      console.warn('Nexus worker did not start', err);
    }
  };
  void resume();
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void resume();
  });
  return () => sub.remove();
}
