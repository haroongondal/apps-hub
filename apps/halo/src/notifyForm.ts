import type { AppInfo, AppNotify, Notify } from 'halo-engine';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A quiet-hours time as typed: '07:05' stays, anything not 24-hour HH:MM is null. */
export const parseTime = (s: string): string | null => (TIME.test(s.trim()) ? s.trim() : null);

/** Apps matching the search (label or package, any case): notified first, then label A to Z. */
export function sortApps(apps: readonly AppInfo[], query: string): AppInfo[] {
  const q = query.trim().toLowerCase();
  return apps
    .filter((a) => q === '' || a.label.toLowerCase().includes(q) || a.pkg.toLowerCase().includes(q))
    .sort((a, b) => Number(b.notified) - Number(a.notified) || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

/** What an app actually gets: its own entry, or the "new apps" default with the icon colour. */
export const appSetting = (notify: Notify, pkg: string): AppNotify =>
  Object.prototype.hasOwnProperty.call(notify.apps, pkg) ? notify.apps[pkg] : { on: notify.defaultOn, colour: null };
