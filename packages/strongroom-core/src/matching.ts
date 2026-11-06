import type { Site } from './entry.ts';
import { publicSuffixRegistrableDomain } from './public-suffix.ts';

const LABELS = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/;
const IPV6 = /^\[[0-9a-f.]*:[0-9a-f:.]*\]$/;
const NUMERIC_LABEL = /^([0-9]+|0x[0-9a-f]*)$/;
const URL_RE = /^(https?):\/\/([^/?#\\]*)(?:[/?#\\].*)?$/is;
// The Android app's IDNA2003 maps these onto other letters (ß onto ss), so hosts holding them match nothing, here and there.
const IDNA_DEVIATIONS = ['ß', 'ẞ', 'ς', '‌', '‍'];

function dnsName(name: string): string | null {
  if (IDNA_DEVIATIONS.some((c) => name.includes(c))) return null;
  const bare = name.endsWith('.') ? name.slice(0, -1) : name;
  if (bare === '' || /[\s/\\?#@:%[\]]/.test(bare)) return null;
  let ascii: string;
  try {
    ascii = new URL(`http://${bare}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  return LABELS.test(ascii) && ascii.length <= 253 && ascii.split('.').every((l) => l.length <= 63) ? ascii : null;
}

export function normalizeHost(host: string): string | null {
  const colon = host.indexOf(':');
  const end = host.startsWith('[') ? host.indexOf(']') + 1 : colon < 0 ? host.length : colon;
  if (end <= 0) return null;
  const name = host.slice(0, end);
  const rest = host.slice(end);
  let port = '';
  if (rest !== '') {
    if (!/^:[0-9]{1,5}$/.test(rest) || Number(rest.slice(1)) < 1 || Number(rest.slice(1)) > 65535) return null;
    port = `:${Number(rest.slice(1))}`;
  }
  const normalized = name.startsWith('[') ? (IPV6.test(name.toLowerCase()) ? name.toLowerCase() : null) : dnsName(name);
  return normalized === null ? null : normalized + port;
}

export function registrableDomain(host: string): string | null {
  const name = normalizeHost(host)?.split(':')[0];
  if (!name || name.startsWith('[') || NUMERIC_LABEL.test(name.slice(name.lastIndexOf('.') + 1))) return null;
  return publicSuffixRegistrableDomain(name);
}

const site = (https: boolean, hostAndPort: string): Site | null => {
  const host = normalizeHost(hostAndPort);
  return host === null ? null : { https, host: host.endsWith(https ? ':443' : ':80') ? host.slice(0, host.lastIndexOf(':')) : host };
};

export function siteFromUrl(url: string): Site | null {
  const m = URL_RE.exec(url.trim());
  return m === null ? null : site(m[1].toLowerCase() === 'https', m[2].slice(m[2].lastIndexOf('@') + 1));
}

// A login saved over https never matches an http page; a host with no registrable domain (IP, intranet name) matches only itself.
export function matches(saved: Site[], requested: Site): boolean {
  const b = normalizeHost(requested.host);
  if (b === null) return false;
  const rb = registrableDomain(b);
  return saved.some((s) => {
    if (s.https && !requested.https) return false;
    const a = normalizeHost(s.host);
    if (a === null) return false;
    const ra = registrableDomain(a);
    return ra !== null && rb !== null ? ra === rb : ra === null && rb === null && a === b;
  });
}
