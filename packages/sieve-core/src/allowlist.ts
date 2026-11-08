import type { DnrRule } from './compile.ts';
import { pageUrl, validateSettings, type AllowEntry } from './settings.ts';

export const ALLOW_FIRST_ID = 1_000_000; // my-filter rules use ids from 1

const IP = /^[\d.]+$/;

export function isAllowed(url: string, entries: AllowEntry[]): boolean {
  const page = pageUrl(url);
  if (page === null) return false;
  const host = new URL(page).hostname.replace(/\.$/, '');
  return entries.some((e) => (e.kind === 'site' ? host === e.host || host.endsWith(`.${e.host}`) : e.url === page));
}

// What the toolbar menu allowlists for a tab: the host without a trailing dot or a leading `www.` (an entry covers subdomains), and the
// page entry's URL. Null where Sieve doesn't run (chrome://, file://, no address). An IPv6 host comes back as is; settings refuse it.
export function tabSite(url: string | undefined): { host: string; page: string } | null {
  const page = url === undefined ? null : pageUrl(url);
  if (page === null) return null;
  return { host: new URL(page).hostname.replace(/\.$/, '').replace(/^www\./, ''), page };
}

const SCHEME = /^[a-z][a-z\d+.-]*:/i;

// The settings page's allowlist box: a full URL, or an address with a path, is a page entry; a bare host (a port is dropped)
// is a site entry without `www.`, like the menu's. A scheme with no host after it (`mailto:`) is refused.
export function allowEntry(input: string): AllowEntry | null {
  const text = input.trim();
  const full = /^[a-z][a-z\d+.-]*:\/\//i.test(text);
  if (!full && SCHEME.test(text) && !/^[^:]*:\d+(?:[/?#]|$)/.test(text)) return null;
  let entry: AllowEntry;
  try {
    const url = new URL(full ? text : `https://${text}`);
    entry = full || url.pathname !== '/' || url.search ? { kind: 'page', url: url.href } : { kind: 'site', host: url.hostname.replace(/^www\./, '') };
  } catch {
    return null;
  }
  return validateSettings({ blocking: { allowlist: [entry] } }).blocking.allowlist[0] ?? null;
}

// allowAllRequests on the frame request also lets through everything the frame and its child frames load.
export function allowRules(entries: AllowEntry[], firstId: number, priority: number): DnrRule[] {
  return entries.map((e, i) => ({
    id: firstId + i,
    priority,
    action: { type: 'allowAllRequests' },
    condition:
      e.kind === 'site'
        ? { requestDomains: [e.host], resourceTypes: ['main_frame', 'sub_frame'] }
        : { regexFilter: `^${e.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(#.*)?$`, isUrlFilterCaseSensitive: true, resourceTypes: ['main_frame', 'sub_frame'] },
  }));
}

// `*.host` covers the host and its subdomains (an IP takes no `*.`). A page is that exact page, as in isAllowed and the allow rule:
// Chrome matches a pattern's path against the URL's path and query (never the hash), with `?` literal, so the entry's own text after the
// origin is kept as it is (`u.search` drops an empty `?`). Entries carry no hash or userinfo. Any port: Chrome refuses `*://host:port`.
export function excludePatterns(hosts: string[], pages: string[]): string[] {
  return [
    ...hosts.map((h) => (IP.test(h) ? `*://${h}/*` : `*://*.${h}/*`)),
    ...pages.map((p) => {
      const u = new URL(p);
      return `*://${u.hostname}${p.slice(u.origin.length)}`;
    }),
  ];
}
