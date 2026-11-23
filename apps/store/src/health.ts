import { HEALTH_AUTHORITIES, appHealthShare, assertRowShape, parseAiSource, type AiSource, type AppHealthRow, type HealthAppId } from '@apps-hub/app-link-contract';
import { ANDROID_PACKAGES } from '@apps-hub/store-manifest';

export type Seen = 'on' | 'off' | 'unknown' | 'none';
export type State = 'on' | 'off' | 'not-sure' | 'unknown';

interface Services {
  accessibility?: string;
  listener?: string;
}

export const SERVICES: Readonly<Record<string, Services>> = {
  deputy: { accessibility: 'expo.modules.deputyagent.android.DeputyAccessibilityService' },
  clipboard: { accessibility: 'expo.modules.clipboardcore.android.CaptureService' },
  halo: {
    accessibility: 'expo.modules.notchisland.android.NotchAccessibilityService',
    listener: 'expo.modules.haloengine.android.HaloListener',
  },
  inflow: { listener: 'expo.modules.inflowcore.android.InflowListener' },
};

const NOT_LISTED = new Set(['store', 'notch']);

export interface HealthApp {
  id: HealthAppId;
  packageName: string;
}

export function healthApps(isInstalled: (packageName: string) => boolean): HealthApp[] {
  return Object.entries(ANDROID_PACKAGES)
    .filter(([id, pkg]) => !NOT_LISTED.has(id) && Object.hasOwn(HEALTH_AUTHORITIES, id) && isInstalled(pkg))
    .map(([id, packageName]) => ({ id: id as HealthAppId, packageName }));
}

export function serviceEnabled(setting: string, pkg: string, cls: string): boolean {
  return setting.split(':').some((entry) => {
    const slash = entry.indexOf('/');
    if (slash < 0 || entry.slice(0, slash) !== pkg) return false;
    const name = entry.slice(slash + 1);
    return (name.startsWith('.') ? pkg + name : name) === cls;
  });
}

// ENABLED_ACCESSIBILITY_SERVICES is public and unset until a service is first turned on, so null means off.
export function accessibilitySeen(setting: string | null, app: HealthApp): Seen {
  const cls = SERVICES[app.id]?.accessibility;
  if (!cls) return 'none';
  return serviceEnabled(setting ?? '', app.packageName, cls) ? 'on' : 'off';
}

// enabled_notification_listeners is hidden; a phone may refuse it, so null means we could not tell.
export function listenerSeen(setting: string | null, app: HealthApp): Seen {
  const cls = SERVICES[app.id]?.listener;
  if (!cls) return 'none';
  if (setting === null) return 'unknown';
  return serviceEnabled(setting, app.packageName, cls) ? 'on' : 'off';
}

const EARLIEST_SEEN = Date.UTC(2024, 0, 1);
const CLOCK_SLACK_MS = 24 * 60 * 60 * 1000;

export function parseHealthRow(rows: unknown, appId: HealthAppId, now: number): AppHealthRow | null {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row: unknown = rows[0];
  try {
    assertRowShape(appHealthShare(appId), row);
  } catch {
    return null;
  }
  const flag = (v: number | null) => v === null || v === 0 || v === 1;
  if (row.app_id !== appId || !flag(row.accessibility) || !flag(row.listener)) return null;
  if (parseAiSource(row.ai_source) === null) return null;
  const seen = row.last_seen_at;
  if (seen !== null && (seen < EARLIEST_SEEN || seen > now + CLOCK_SLACK_MS)) return null;
  return row;
}

export function reconcile(seen: Seen, reported: number | null | undefined): State | null {
  const own = reported === 1 ? 'on' : reported === 0 ? 'off' : null;
  if (seen === 'on' || seen === 'off') return own && own !== seen ? 'not-sure' : seen;
  if (own) return own;
  return seen === 'unknown' ? 'unknown' : null;
}

export type Tone = 'ok' | 'warn' | 'neutral';
export type Fix = 'accessibility' | 'listener';

export interface Line {
  label: string;
  tone: Tone;
  todo?: string;
  fix?: Fix;
}

const WORDS: Record<State, string> = { on: 'on', off: 'off', 'not-sure': 'not sure', unknown: 'unknown' };

function serviceLine(kind: Fix, state: State, name: string): Line {
  const what = kind === 'accessibility' ? 'Accessibility' : 'Notification access';
  const label = `${what}: ${WORDS[state]}`;
  if (state === 'on') return { label, tone: 'ok' };
  const page = kind === 'accessibility' ? `Open accessibility settings, tap ${name}, and turn it on.` : `Open notification access and turn it on for ${name}.`;
  const todo =
    state === 'off' ? page
    : state === 'not-sure' ? `This phone and ${name} disagree. Open ${name} once, then come back here.`
    : `This phone does not let Store check this. Open notification access to see it for ${name}.`;
  return { label, tone: state === 'unknown' ? 'neutral' : 'warn', todo, fix: kind };
}

const AI_WORDS: Record<AiSource, string> = { hub: 'AI: from AI hub', own: 'AI: own key', none: 'AI: none' };

export interface AppHealth {
  lines: Line[];
  needsLook: boolean;
}

export function appHealth(app: HealthApp, name: string, settings: { accessibility: string | null; listeners: string | null }, report: AppHealthRow | null): AppHealth {
  const lines: Line[] = [];
  const a11y = reconcile(accessibilitySeen(settings.accessibility, app), report?.accessibility);
  const listener = reconcile(listenerSeen(settings.listeners, app), report?.listener);
  if (a11y) lines.push(serviceLine('accessibility', a11y, name));
  if (listener) lines.push(serviceLine('listener', listener, name));
  const ai = report && parseAiSource(report.ai_source);
  lines.push(ai ? { label: AI_WORDS[ai], tone: 'neutral' } : { label: 'Not reported', tone: 'neutral' });
  return { lines, needsLook: lines.some((l) => l.tone === 'warn') };
}

export function needsAutostart(app: HealthApp): boolean {
  return Object.hasOwn(SERVICES, app.id);
}

export const AUTOSTART_STEPS = 'Tap Open app settings, turn on Autostart, then open Battery saver and choose No restrictions.';
