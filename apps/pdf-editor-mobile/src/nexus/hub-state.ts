import type { ErrorKind } from 'ai-hub-client/src/contract.ts';

/** What Nexus can say about AI hub: ready, or the one thing the owner has to do. */
export type HubState = 'ready' | 'missing' | 'not-allowed' | 'no-key' | 'version';
export type HubProblem = Exclude<HubState, 'ready'>;

export function hubStateOf(kind: ErrorKind): HubProblem | null {
  if (kind === 'hub-missing') return 'missing';
  if (kind === 'not-allowed') return 'not-allowed';
  if (kind === 'no-key') return 'no-key';
  if (kind === 'version') return 'version';
  return null;
}

export interface HubCopy {
  title: string;
  body: string;
  button: string;
  opens: 'store' | 'ai-hub';
}

export const HUB_COPY: Record<HubProblem, HubCopy> = {
  missing: {
    title: 'AI needs AI hub',
    body: 'Install AI hub to transcribe, find ideas and ask questions. Until then nothing leaves this phone.',
    button: 'Install AI hub',
    opens: 'store',
  },
  'not-allowed': {
    title: 'Allow Nexus in AI hub',
    body: 'Open AI hub and turn Nexus on. Until then nothing leaves this phone.',
    button: 'Open AI hub',
    opens: 'ai-hub',
  },
  'no-key': {
    title: 'Add a key in AI hub',
    body: 'AI hub has no key for this yet. Open AI hub and add one.',
    button: 'Open AI hub',
    opens: 'ai-hub',
  },
  version: {
    title: 'Update AI hub',
    body: 'This AI hub is too old for Nexus. Update it from the Store.',
    button: 'Open the Store',
    opens: 'store',
  },
};

/** The queue row and the Stream notice when AI hub keeps not answering (offline, or a service that fails). */
export const WAITING_LINE = 'Waiting for AI hub to answer';

/** Shown on Stream while items wait for an answer, so a hub that never answers (bad keys, no connection) is not silent. */
export const WAITING_COPY: HubCopy = {
  title: 'AI hub is not answering',
  body: 'Items wait, and Nexus tries again each time you open it. If this stays, open AI hub and check its keys, then your connection.',
  button: 'Open AI hub',
  opens: 'ai-hub',
};

export const READY_MS = 60_000;

export interface HubGateOptions {
  check(): Promise<HubState>;
  now?(): number;
}

/** A problem stays until `forget` (the owner went to fix it and came back); a ready answer is trusted for a minute. */
export function hubGate({ check, now = Date.now }: HubGateOptions) {
  let known: { state: HubState; at: number } | null = null;
  return {
    async state(): Promise<HubState> {
      if (known && (known.state !== 'ready' || now() - known.at < READY_MS)) return known.state;
      const state = await check();
      known = { state, at: now() };
      return state;
    },
    set(state: HubState): void {
      known = { state, at: now() };
    },
    forget(): void {
      known = null;
    },
  };
}
