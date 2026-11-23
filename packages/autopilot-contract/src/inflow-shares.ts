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
