import type { Clip } from 'clipboard-core';
import { ibanTodo, type InflowTodo } from './inflow.ts';

export type FoundKind = 'link' | 'phone' | 'tracking' | 'iban' | 'address';
export type Carrier = 'ups' | 'fedex' | 'dhl' | 'usps' | 'tcs' | 'leopards' | 'mp' | 'pakpost';

export interface Found {
  kind: FoundKind;
  value: string;
  carrier?: Carrier;
}

export interface SmartAction {
  kind: FoundKind;
  label: string;
  accessibilityLabel: string;
  uri?: string;
  copy?: string;
  /** IBANs only: the to-do Inflow's ADD_TODO screen opens with. */
  todo?: InflowTodo;
}

const SCAN_LIMIT = 2000;
const QUERY_LIMIT = 200;

const LINK = /\bhttps?:\/\/\S+/gi;
const LINK_TAIL = /[.,;:!?)\]}'"]+$/;
const WEB = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*)?$/;
const PHONE = /(?<![\w+])\+?\d[\d -]{6,17}\d(?![\w])/g;
const E164 = /^\+[1-9]\d{7,14}$/;
const PK_MOBILE = /^03\d{9}$/;

export function smartActions(clip: Clip): SmartAction[] {
  return recognise(clip).map(actionFor);
}

export function recognise(clip: Clip): Found[] {
  if (clip.kind !== 'text' || !clip.text) return [];
  let rest = clip.text.slice(0, SCAN_LIMIT);
  const found: Found[] = [];
  const take = (hit: { found: Found; raw: string } | null) => {
    if (!hit) return;
    found.push(hit.found);
    rest = rest.split(hit.raw).join(' ');
  };
  take(findLink(rest));
  take(findPhone(rest));
  take(findIban(rest));
  take(findTracking(rest));
  take(findAddress(rest));
  return found;
}

/** One action per recognised item; an IBAN's also carries Inflow's "Add to Inflow" to-do. */
export function actionFor(found: Found): SmartAction {
  const { kind, value } = found;
  if (kind === 'link') return { kind, label: 'Open link', accessibilityLabel: `Open link ${hostOf(value)}`, uri: value };
  if (kind === 'phone') return { kind, label: 'Call', accessibilityLabel: `Call ${value}`, uri: `tel:${value}` };
  if (kind === 'iban') {
    const formatted = formatIban(value);
    return { kind, label: 'Copy IBAN', accessibilityLabel: `Copy IBAN ${formatted}`, copy: formatted, todo: ibanTodo(formatted) };
  }
  if (kind === 'tracking') {
    const carrier = CARRIERS[found.carrier!];
    return { kind, label: 'Track parcel', accessibilityLabel: `Track parcel ${value} with ${carrier.name}`, uri: carrier.url(value) };
  }
  return { kind, label: 'Open map', accessibilityLabel: `Open map for ${value}`, uri: `geo:0,0?q=${encodeQuery(value)}` };
}

function findLink(text: string) {
  for (const m of text.matchAll(LINK)) {
    const raw = m[0].replace(LINK_TAIL, '');
    const url = raw.replace(/^https?/i, (s) => s.toLowerCase());
    if (WEB.test(url) && hostOf(url).includes('.')) return { found: { kind: 'link' as const, value: url }, raw };
  }
  return null;
}

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').split(/[/:?#]/)[0];
}

function findPhone(text: string) {
  for (const m of text.matchAll(PHONE)) {
    const tokens = m[0].split(' ');
    for (let i = 0; i < tokens.length; i++) {
      for (let j = tokens.length; j > i; j--) {
        const raw = tokens.slice(i, j).join(' ');
        const dial = raw.replace(/[ -]/g, '');
        if (E164.test(dial) || PK_MOBILE.test(dial)) return { found: { kind: 'phone' as const, value: dial }, raw };
      }
    }
  }
  return null;
}

const IBAN_LENGTH: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24,
  DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28,
  HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20,
  LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25,
  QA: 29, RO: 24, RS: 22, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26,
  UA: 29, VA: 22, VG: 24, XK: 20,
};
const IBAN_START = /\b[A-Z]{2}\d{2}[A-Z0-9]*(?: [A-Z0-9]+)*/g;

function findIban(text: string) {
  for (const m of text.matchAll(IBAN_START)) {
    const length = IBAN_LENGTH[m[0].slice(0, 2)];
    if (!length) continue;
    const parts = m[0].split(' ');
    let compact = '';
    for (let i = 0; i < parts.length && compact.length < length; i++) {
      compact += parts[i];
      if (compact.length === length && isValidIban(compact)) {
        return { found: { kind: 'iban' as const, value: compact }, raw: parts.slice(0, i + 1).join(' ') };
      }
    }
  }
  return null;
}

export function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban) || IBAN_LENGTH[iban.slice(0, 2)] !== iban.length) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const n = ch >= 'A' ? ch.charCodeAt(0) - 55 : Number(ch);
    rem = n > 9 ? (rem * 100 + n) % 97 : (rem * 10 + n) % 97;
  }
  return rem === 1;
}

export function formatIban(iban: string): string {
  return iban.replace(/(.{4})(?=.)/g, '$1 ');
}

interface CarrierInfo {
  name: string;
  url: (n: string) => string;
}

const CARRIERS: Record<Carrier, CarrierInfo> = {
  ups: { name: 'UPS', url: (n) => `https://www.ups.com/track?tracknum=${n}` },
  fedex: { name: 'FedEx', url: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}` },
  dhl: { name: 'DHL', url: (n) => `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${n}` },
  usps: { name: 'USPS', url: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}` },
  tcs: { name: 'TCS', url: (n) => `https://www.tcsexpress.com/track/${n}` },
  leopards: { name: 'Leopards', url: (n) => `https://www.leopardscourier.com/shipment_tracking_view?cn_number=${n}` },
  mp: { name: 'M&P', url: (n) => `https://www.mulphilog.com/tracking/${n}` },
  pakpost: { name: 'Pakistan Post', url: (n) => `https://ep.gov.pk/emtts/EPTrack_Live.aspx?ArticleIDz=${n}` },
};

const OWN_FORMAT: Array<{ carrier: Carrier; re: RegExp; check?: (n: string) => boolean }> = [
  { carrier: 'ups', re: /\b1Z[0-9A-Z]{16}\b/g },
  { carrier: 'dhl', re: /\bJD\d{18}\b/g },
  { carrier: 'usps', re: /(?<!\d)9[2-5]\d{20}(?!\d)/g },
  { carrier: 'pakpost', re: /\b[A-Z]{2}\d{9}PK\b/g, check: isValidS10 },
];
// Bare digits are too common to guess from, so these count only when the carrier is named in the same clip; an unnamed number gives nothing.
const NAMED: Array<{ carrier: Carrier; name: RegExp; re: RegExp; check?: (n: string) => boolean }> = [
  { carrier: 'fedex', name: /\bfed\s?ex\b/i, re: /(?<![\w])(?:\d{12}|\d{15})(?![\w])/g },
  { carrier: 'dhl', name: /\bdhl\b/i, re: /(?<![\w])\d{10}(?![\w])/g },
  { carrier: 'usps', name: /\busps\b/i, re: /(?<![\w])\d{20,22}(?![\w])/g },
  { carrier: 'tcs', name: /\btcs\b/i, re: /(?<![\w])\d{9,12}(?![\w])/g },
  { carrier: 'leopards', name: /\bleopards?\b/i, re: /(?<![\w])[A-Z]{0,3}\d{7,15}(?![\w])/g },
  { carrier: 'mp', name: /\bm\s?&\s?p\b|\bmulphilog\b/i, re: /(?<![\w])[A-Z]{0,3}\d{7,15}(?![\w])/g },
  { carrier: 'pakpost', name: /\bpak(?:istan)? post\b/i, re: /\b[A-Z]{2}\d{9}[A-Z]{2}\b/g, check: isValidS10 },
];

function findTracking(text: string) {
  for (const { carrier, re, check } of OWN_FORMAT) {
    const hit = firstMatch(text, re, check);
    if (hit) return { found: { kind: 'tracking' as const, value: hit, carrier }, raw: hit };
  }
  for (const { carrier, name, re, check } of NAMED) {
    if (!name.test(text)) continue;
    const hit = firstMatch(text, re, check);
    if (hit) return { found: { kind: 'tracking' as const, value: hit, carrier }, raw: hit };
  }
  return null;
}

function firstMatch(text: string, re: RegExp, check?: (n: string) => boolean): string | null {
  for (const m of text.matchAll(re)) if (!check || check(m[0])) return m[0];
  return null;
}

export function isValidS10(id: string): boolean {
  const digits = id.slice(2, 10);
  const weights = [8, 6, 4, 2, 3, 5, 9, 7];
  const sum = [...digits].reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
  const c = 11 - (sum % 11);
  const check = c === 10 ? 0 : c === 11 ? 5 : c;
  return Number(id[10]) === check;
}

const STREET =
  /\b\d{1,5}[A-Za-z]?,?\s+(?:[A-Z][A-Za-z'.-]*\s+){1,4}(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Boulevard|Blvd|Drive|Dr|Way|Court|Ct|Place|Pl|Close|Crescent|Terrace|Parkway|Pkwy|Highway|Hwy|Square|Sq)\b/;
const HOUSE_STREET = /\b(?:[Hh]ouse|H)\s*(?:[Nn]o\.?|#)?\s*\d+[A-Za-z]?\s*,?\s*(?:[Ss]treet|St|[Gg]ali|[Ll]ane)\s*(?:[Nn]o\.?|#)?\s*\d+\b/;
const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]? \d[ABD-HJLNP-UW-Z]{2}\b/;

function findAddress(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const at = lines.findIndex((l) => STREET.test(l) || HOUSE_STREET.test(l) || UK_POSTCODE.test(l));
  if (at < 0) return null;
  const block = lines.length <= 4 ? lines.join(', ') : lines[at];
  const query = block.replace(/(,\s*)+/g, ', ').replace(/^[,\s]+|[,\s]+$/g, '').slice(0, QUERY_LIMIT);
  return { found: { kind: 'address' as const, value: query }, raw: lines[at] };
}

function encodeQuery(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
