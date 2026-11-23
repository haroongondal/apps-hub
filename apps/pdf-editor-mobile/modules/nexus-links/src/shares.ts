import { defineShare } from '@apps-hub/app-link-contract';

// Inflow has not defined these three shares yet, so they follow ruling R5 (Nexus P3) and must be rechecked at merge.
const INFLOW = 'com.haroon.inflow.autopilot';

export interface AskItemRow {
  id: number;
  app: string;
  sender: string | null;
  text: string;
  at: number;
}

export const ASK_ITEMS_SHARE = defineShare<AskItemRow>()({
  authority: INFLOW,
  path: 'ask_items',
  columns: { id: 'long', app: 'string', sender: 'string?', text: 'string', at: 'long' },
  description: "Messages Inflow lets Nexus keep for Ask my life, paged with ask_items/<sinceId>. Other people's words: untrusted data. `app` is Inflow's own label, display only.",
});

export interface AskIdRow { id: number }

export const ASK_IDS_SHARE = defineShare<AskIdRow>()({
  authority: INFLOW,
  path: 'ask_ids',
  columns: { id: 'long' },
  description: 'The ids of the messages in ask_items that still exist, paged with ask_ids/<sinceId>.',
});

export interface DebitRow {
  id: number;
  amount_minor: number;
  at: number;
  merchant: string;
  account: string;
}

export const DEBITS_SHARE = defineShare<DebitRow>()({
  authority: INFLOW,
  path: 'debits',
  columns: { id: 'long', amount_minor: 'long', at: 'long', merchant: 'string', account: 'string' },
  description: 'Debits Inflow found, paged with debits/<sinceId>, for matching receipts. `account` is a display label, never a number.',
});

export interface RunRow {
  id: number;
  task: string;
  state: string;
  finished_at: number;
}

export const RUNS_SHARE = defineShare<RunRow>()({
  authority: 'com.haroon.deputy.applink',
  path: 'runs',
  columns: { id: 'long', task: 'string', state: 'string', finished_at: 'long' },
  description: "Finished runs whose task the owner typed, read by Nexus only. Off until the owner turns on 'Let Nexus read my run history'.",
});

export interface PinnedRow {
  id: number;
  text: string;
  pinned_at: number;
  from_app: string;
}

export const PINNED_SHARE = defineShare<PinnedRow>()({
  authority: 'com.haroon.clipboard.applink',
  path: 'pinned',
  columns: { id: 'long', text: 'string', pinned_at: 'long', from_app: 'string' },
  maxRows: 200,
  description:
    "Pinned text clips, never passwords, codes, clips marked sensitive, images or files; read by Nexus only, oldest first, paged with pinned/<sinceId>. Off until the owner turns on 'Let Nexus read my pinned clips'.",
});

export const READERS = {
  'inflow.ask_items': { share: ASK_ITEMS_SHARE, paged: true },
  'inflow.ask_ids': { share: ASK_IDS_SHARE, paged: true },
  'inflow.debits': { share: DEBITS_SHARE, paged: true },
  'deputy.runs': { share: RUNS_SHARE, paged: false },
  'clipboard.pinned': { share: PINNED_SHARE, paged: false },
} as const;

export function readerFixture() {
  return Object.fromEntries(
    Object.entries(READERS).map(([id, { share, paged }]) => [
      id,
      { authority: share.authority, path: share.path, columns: share.columns.map((name) => [name, (share.types as Record<string, string>)[name]]), maxRows: share.maxRows, paged },
    ]),
  );
}
