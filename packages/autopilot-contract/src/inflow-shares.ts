import { appHealthShare } from '@apps-hub/app-link-contract';

// Inflow's link shares beyond Deputy's suggestions. Deliberately not exported from index.ts: index.ts runs in Metro, which must not resolve app-link-contract's own entry for this.
// Each share has a fixture the Kotlin provider test is bound to; later shares are added here.

/** The Store's health row. Inflow serves it on the legacy authority, behind the same caller check as every path. */
export const INFLOW_HEALTH_SHARE = appHealthShare('inflow');
