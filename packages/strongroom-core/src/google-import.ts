import { parseCsv } from './csv.ts';
import type { AppLink, Login } from './entry.ts';
import { registrableDomain, siteFromUrl } from './matching.ts';

export type ImportResult = { logins: Login[]; merged: number; flagged: number };

export class ImportError extends Error {}

const NOT_GOOGLE = "This file isn't a Google Passwords export. Export again from Google Password Manager and pick that file.";
const DAMAGED = 'This file is damaged: a quoted field never ends. Export again from Google Password Manager.';
export const FLAG_PREFIX = 'Imported twice with different passwords. Delete the wrong one.\n';
const ANDROID = 'android://';

// place is what the login is for. A linked login uses its sites and apps; an unlinked one its raw URL (else its name), so unrelated ones never pool.
type Row = { place: string; importedFrom: string | null; login: Login };

/** [base64 hash, package] of `android://<hash>@<package>/`; the hash may contain '/' but never '@', so split on the first '@'. */
function androidUrl(url: string): [string, string] | null {
  if (!url.toLowerCase().startsWith(ANDROID)) return null;
  const rest = url.slice(ANDROID.length);
  const at = rest.indexOf('@');
  if (at < 0) return null;
  const pkg = rest.slice(at + 1).split('/')[0];
  return /^[A-Za-z0-9_.]+$/.test(pkg) ? [rest.slice(0, at), pkg] : null;
}

function certHex(b64: string): string | null {
  const bare = b64.replace(/=+$/, '');
  for (const urlSafe of [false, true]) {
    if (!(urlSafe ? /^[A-Za-z0-9_-]*$/ : /^[A-Za-z0-9+/]*$/).test(bare) || bare.length % 4 === 1) continue;
    const std = urlSafe ? bare.replaceAll('-', '+').replaceAll('_', '/') : bare;
    const bin = atob(std.padEnd(Math.ceil(std.length / 4) * 4, '='));
    if (bin.length === 32) return Array.from(bin, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  }
  return null;
}

export function parseGoogleExport(csv: string, now: number): ImportResult {
  let records: string[][];
  try {
    records = parseCsv(csv);
  } catch {
    throw new ImportError(DAMAGED);
  }
  records = records.filter((row) => !row.every((cell) => cell === ''));
  const header = records[0]?.map((c) => c.trim().toLowerCase());
  if (!header) throw new ImportError(NOT_GOOGLE);
  const [nameAt, urlAt, userAt, passAt] = ['name', 'url', 'username', 'password'].map((h) => header.indexOf(h));
  if (Math.min(nameAt, urlAt, userAt, passAt) < 0) throw new ImportError(NOT_GOOGLE);
  const noteAt = header.indexOf('note');

  const rows: Row[] = records.slice(1).map((row, n) => {
    if (row.length > header.length) {
      throw new ImportError(`Row ${n + 1} of this file has more columns than its header, so a value may be split. Export again from Google Password Manager.`);
    }
    const cell = (at: number) => row[at] ?? '';
    const url = cell(urlAt).trim();
    const name = cell(nameAt);
    const site = siteFromUrl(url);
    const android = androidUrl(url);
    const cert = android && certHex(android[0]);
    const app: AppLink | null = android && cert ? { pkg: android[1], certSha256: cert, domain: null } : null;
    const unlinked = site === null && app === null;
    return {
      place: JSON.stringify(!unlinked ? [site ? [site] : [], app ? [app] : []] : url !== '' ? ['url', url] : ['name', name.trim()]),
      importedFrom: unlinked && url !== '' ? url : null,
      login: {
        type: 'login',
        name: name.trim() !== '' ? name : site ? (registrableDomain(site.host) ?? site.host) : (android?.[1] ?? ''),
        username: cell(userAt),
        password: cell(passAt),
        sites: site ? [site] : [],
        apps: app ? [app] : [],
        note: cell(noteAt),
        updatedAt: now,
      },
    };
  });

  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.place, row.login.username, row.login.password]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const usersPerPlace = new Map<string, number>();
  for (const [first] of groups.values()) {
    const key = JSON.stringify([first.place, first.login.username]);
    usersPerPlace.set(key, (usersPerPlace.get(key) ?? 0) + 1);
  }
  let flagged = 0;
  const logins = [...groups.values()].map((group) => {
    const first = group[0];
    const isFlagged = (usersPerPlace.get(JSON.stringify([first.place, first.login.username])) ?? 0) > 1;
    if (isFlagged) flagged++;
    const lines = [...new Set(group.map((r) => r.login.note).filter((n) => n.trim() !== ''))];
    if (first.importedFrom) lines.push(`Imported from ${first.importedFrom}`);
    return { ...first.login, note: (isFlagged ? FLAG_PREFIX : '') + lines.join('\n') };
  });
  return { logins, merged: rows.length - groups.size, flagged };
}
