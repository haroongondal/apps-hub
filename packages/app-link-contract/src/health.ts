import { defineShare } from './share.ts';
import type { Share } from './share.ts';

export type AiSource = 'hub' | 'own' | 'none';
export const AI_SOURCES: readonly AiSource[] = ['hub', 'own', 'none'];

export interface AppHealthRow {
  app_id: string;
  accessibility: number | null;
  listener: number | null;
  ai_source: AiSource;
  /** The app's own heartbeat (epoch ms), written while it runs; a provider query never updates it. */
  last_seen_at: number | null;
}

// Keys are release app ids; inflow keeps its legacy authority so its existing provider serves `health` too.
export const HEALTH_AUTHORITIES = {
  netlens: 'com.haroon.netlens.applink',
  'open-tunnel': 'com.haroon.opentunnel.applink',
  'pdf-editor': 'com.haroon.pdfeditor.applink',
  'design-editor': 'com.haroon.designeditor.applink',
  deputy: 'com.haroon.deputy.applink',
  strongroom: 'com.haroon.strongroom.applink',
  inflow: 'com.haroon.inflow.autopilot',
  clipboard: 'com.haroon.clipboard.applink',
  halo: 'com.haroon.halo.applink',
  'ai-hub': 'com.haroon.aihub.applink',
} as const;
export type HealthAppId = keyof typeof HEALTH_AUTHORITIES;

export const HEALTH_PATH = 'health';

export function appHealthShare(app: HealthAppId): Share<AppHealthRow> {
  if (!Object.hasOwn(HEALTH_AUTHORITIES, app)) throw new Error(`no health authority for app ${JSON.stringify(app)}`);
  return defineShare<AppHealthRow>()({
    authority: HEALTH_AUTHORITIES[app],
    path: HEALTH_PATH,
    columns: { app_id: 'string', accessibility: 'int?', listener: 'int?', ai_source: 'string', last_seen_at: 'long?' },
    maxRows: 1,
    description: `Health of ${app}: accessibility and notification listener on or off, where its AI keys come from, and its last heartbeat. Read by the Store; no personal data.`,
  });
}

export function parseAiSource(value: unknown): AiSource | null {
  return AI_SOURCES.find((s) => s === value) ?? null;
}
