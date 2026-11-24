import { SourceSync, type Knowledge, type SwitchStore } from '@apps-hub/knowledge-core';
import { SOURCE_APPS, type SourceApp } from '@apps-hub/library-core';
import { NexusLinks } from 'nexus-links';
import { AppState } from 'react-native';

import { sourceProviders } from '../links/readers';

import { createAskRunner, statusLine, type Reports } from './ask-runner';
import { sourceSwitches } from './meta-flags';
import { emit, kick, openKnowledge } from './worker';

interface Parts {
  kn: Knowledge;
  switches: SwitchStore;
  runner: ReturnType<typeof createAskRunner>;
}

export interface AskState {
  on: boolean;
  /** Why a switched-on source says nothing, in plain words; null when all is well. */
  line: string | null;
  kept: number;
}

// Exactly one SourceSync per process: its stop-on-turn-off guard lives in memory (knowledge-core sources.ts).
let opening: Promise<Parts> | null = null;

function parts(): Promise<Parts> {
  if (!opening) {
    opening = (async () => {
      const kn = await openKnowledge();
      const switches = sourceSwitches(kn.lib.db);
      const sync = new SourceSync(kn, sourceProviders(NexusLinks), switches);
      return { kn, switches, runner: createAskRunner({ sync, after, wiped: emit }) };
    })();
    opening.catch(() => {
      opening = null;
    });
  }
  return opening;
}

// New or changed items need their embeddings: the existing worker does that, through AI hub.
async function after(reports: Reports): Promise<void> {
  const all = Object.values(reports);
  if (all.some((r) => r.added || r.updated || r.removed)) emit();
  if (all.some((r) => r.added || r.updated)) await kick();
}

/** Reads every source the owner switched on. Safe to call from anywhere and as often as needed: runs never overlap and nothing throws. */
export async function syncAskSources(): Promise<void> {
  try {
    await (await parts()).runner.request();
  } catch (err) {
    console.warn('Nexus could not read the other apps', err);
  }
}

/** On app start and whenever the app comes back to the foreground. No timer and no background service. */
export function startAskSources(): () => void {
  void syncAskSources();
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void syncAskSources();
  });
  return () => sub.remove();
}

export async function askState(): Promise<Record<SourceApp, AskState>> {
  const { kn, switches, runner } = await parts();
  const last = runner.last();
  const entries = await Promise.all(
    SOURCE_APPS.map(async (app) => {
      const on = await switches.get(app);
      return [app, { on, line: on ? statusLine(app, last[app]) : null, kept: (await kn.lib.listSourceIds(app)).length }] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<SourceApp, AskState>;
}

export async function turnOnSource(app: SourceApp): Promise<void> {
  await (await parts()).runner.turnOn(app);
}

/** Deletes everything kept from the app at once, then refreshes whatever is showing it. Returns how many items went. */
export async function turnOffSource(app: SourceApp): Promise<number> {
  return (await parts()).runner.turnOff(app);
}
