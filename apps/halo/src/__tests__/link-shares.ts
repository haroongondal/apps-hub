// Test-only, so Metro never resolves app-link-contract. Copied from eco/homenet home-shares.ts, eco/tunnelwall shield-share.ts, eco/deputy src/links.ts
// and autopilot-contract; import the real ones once those branches merge. BRIEFING is not declared on eco/inflow yet, and defineShare refuses `private`, so it reads `personal`.
import { appHealthShare, defineShare } from '@apps-hub/app-link-contract';

export const WHO_IS_HOME = defineShare<{ person: string; present: number; last_seen_at: number }>()({
  authority: 'com.haroon.netlens.applink',
  path: 'who_is_home',
  columns: { person: 'string', present: 'int', last_seen_at: 'long' },
  maxRows: 16,
  description: 'Who is home by the background check: the tag the owner gave a person, 1 when home, when last seen',
});

export const NEW_DEVICES = defineShare<{ first_seen_at: number; label: string; acknowledged: number }>()({
  authority: 'com.haroon.netlens.applink',
  path: 'new_devices',
  columns: { first_seen_at: 'long', label: 'string', acknowledged: 'int' },
  maxRows: 200,
  description: 'Devices the background check found new on the home Wi-Fi: when, a guess of what it is, 1 when the owner said it is theirs',
});

export const SHIELD = defineShare<{ on: number; untrusted_now: number; since: number }>()({
  authority: 'com.haroon.opentunnel.applink',
  path: 'shield',
  columns: { on: 'int', untrusted_now: 'int', since: 'long' },
  maxRows: 1,
  description: "TunnelWall's Shields: on, whether the phone is on a network the owner does not trust, since when.",
});

export const TUNNEL_HEALTH = appHealthShare('open-tunnel');

export const DEPUTY_WAITING = defineShare<{ id: number; label: string; due_at: number | null; state: string }>()({
  authority: 'com.haroon.deputy.applink',
  path: 'waiting',
  columns: { id: 'long', label: 'string', due_at: 'long?', state: 'string' },
  maxRows: 100,
  description: 'What waits for the owner in Deputy (an OK, the next repeating tasks, drafts).',
});

export const SUGGESTIONS = defineShare<{
  id: number; kind: string; title: string; item_id: number; due_at: number | null; state: string; created_at: number; expires_at: number;
}>()({
  authority: 'com.haroon.inflow.autopilot',
  path: 'suggestions',
  columns: { id: 'long', kind: 'string', title: 'string', item_id: 'long', due_at: 'long?', state: 'string', created_at: 'long', expires_at: 'long' },
  description: 'Autopilot suggestions: one row per card Inflow shows',
});

export const BRIEFING = defineShare<{ line_id: number; kind: string; text: string; at: number | null; personal: number }>()({
  authority: 'com.haroon.inflow.autopilot',
  path: 'briefing',
  columns: { line_id: 'long', kind: 'string', text: 'string', at: 'long?', personal: 'int' },
  maxRows: 20,
  description: "Inflow's morning briefing lines, built in code; personal = 1 for medicine and steps lines",
});

export const READ_SHARES = {
  who_is_home: WHO_IS_HOME,
  new_devices: NEW_DEVICES,
  shield: SHIELD,
  tunnel_health: TUNNEL_HEALTH,
  deputy_waiting: DEPUTY_WAITING,
  suggestions: SUGGESTIONS,
  briefing: BRIEFING,
} as const;
