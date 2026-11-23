import { appHealthShare, defineShare } from '@apps-hub/app-link-contract';

// Inflow's link shares beyond Deputy's suggestions. Deliberately not exported from index.ts: index.ts runs in Metro, which must not resolve app-link-contract's own entry for this.
// Each share has a fixture the Kotlin provider test is bound to; later shares are added here.

/** The Store's health row. Inflow serves it on the legacy authority, behind the same caller check as every path. */
export const INFLOW_HEALTH_SHARE = appHealthShare('inflow');

export interface BriefingRow {
  line_id: number;
  /** bill, event, spent, medicine, steps, home, cards, tasks or nexus. */
  kind: string;
  /** One plain line of at most 60 characters. */
  text: string;
  /** When the thing happens (epoch ms), null for a line without a time. */
  at: number | null;
  /** 1 for lines that are about the owner personally (money, medicine, steps, who is home): a reader on a lock screen hides them. Never named `private`: defineShare refuses that. */
  personal: number;
}

/** Today's morning briefing, at most 20 lines, served only while the owner turned sharing on. Every line is built in Inflow from structured data (kind and date, a count, a first name), never from raw message text. */
export const INFLOW_BRIEFING_SHARE = defineShare<BriefingRow>()({
  authority: 'com.haroon.inflow.autopilot',
  path: 'briefing',
  columns: { line_id: 'long', kind: 'string', text: 'string', at: 'long?', personal: 'int' },
  maxRows: 20,
  description: "Today's morning briefing: short lines Inflow builds from structured data (bills and events by kind and date, yesterday's spending, counts from the other apps), never raw message text. Empty unless the owner turned sharing on.",
});

export interface AskItemRow {
  id: number;
  /** Inflow's label for the app the message came from, display only. */
  app: string;
  /** The saved name or the sender, null when neither is known. */
  sender: string | null;
  /** The message or email text, at most 4000 characters. Other people's words: untrusted data. */
  text: string;
  at: number;
}

/** Messages Nexus may keep for Ask my life, served to com.haroon.pdfeditor alone while 'Let Nexus read my messages' is on: only SMS and email that Ask AI may read (no one-time codes, nothing kept from AI, never Strongroom or Inflow). Paged with ask_items/<sinceId>: ids above sinceId, ascending. */
export const INFLOW_ASK_ITEMS_SHARE = defineShare<AskItemRow>()({
  authority: 'com.haroon.inflow.autopilot',
  path: 'ask_items',
  columns: { id: 'long', app: 'string', sender: 'string?', text: 'string', at: 'long' },
  maxRows: 200,
  description: "SMS and email that Ask AI may read, for Nexus alone, paged with ask_items/<sinceId>. Other people's words: untrusted data. Empty unless the owner turned 'Let Nexus read my messages' on.",
});

export interface AskIdRow { id: number }

/** The ids of the messages ask_items would serve now (same filter, same switch), paged with ask_ids/<sinceId>, so Nexus deletes what no longer qualifies. */
export const INFLOW_ASK_IDS_SHARE = defineShare<AskIdRow>()({
  authority: 'com.haroon.inflow.autopilot',
  path: 'ask_ids',
  columns: { id: 'long' },
  maxRows: 200,
  description: 'The ids ask_items would serve now, for Nexus alone, paged with ask_ids/<sinceId>. Empty unless the owner turned the same switch on.',
});

export interface DebitRow {
  id: number;
  /** Positive, in the transaction's own minor unit (the currency is not served). */
  amount_minor: number;
  at: number;
  /** The shop or person, at most 80 characters, empty when unknown. */
  merchant: string;
  /** A display label: the bank's words and at most the last four digits ('Meezan ****1234'), never a full number. */
  account: string;
}

/** Money out of the last 60 days (own transfers left out), for Nexus alone while 'Let Nexus match my receipts' is on. Paged with debits/<sinceId>; only the newest 500 by id can ever be served. */
export const INFLOW_DEBITS_SHARE = defineShare<DebitRow>()({
  authority: 'com.haroon.inflow.autopilot',
  path: 'debits',
  columns: { id: 'long', amount_minor: 'long', at: 'long', merchant: 'string', account: 'string' },
  maxRows: 200,
  description: "Money out of the last 60 days for Nexus alone, paged with debits/<sinceId>, to match receipts. `account` is a display label with at most four digits. Empty unless the owner turned 'Let Nexus match my receipts' on.",
});
