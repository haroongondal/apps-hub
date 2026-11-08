import { isHost, pageUrl } from './settings.ts';

export interface ElementInfo {
  tag: string;
  id: string;
  classes: string[];
  nth: number; // 1-based :nth-of-type
}

const PLAIN_ID = /^[A-Za-z][\w-]*$/;
const generated = (cls: string) => cls.replace(/\D/g, '').length >= 3;

function escapeIdent(s: string): string {
  return [...s]
    .map((c, i) => {
      const code = c.codePointAt(0) as number;
      if (code === 0) return '�';
      if (code < 0x20 || code === 0x7f || (c >= '0' && c <= '9' && (i === 0 || (i === 1 && s[0] === '-')))) return `\\${code.toString(16)} `;
      if (c === '-' && s.length === 1) return '\\-';
      return code >= 0x80 || /[\w-]/.test(c) ? c : `\\${c}`;
    })
    .join('');
}

export function simpleSelector(info: ElementInfo): string {
  if (PLAIN_ID.test(info.id)) return `#${info.id}`;
  const classes = info.classes.filter((c) => !generated(c));
  const tag = escapeIdent(info.tag);
  return classes.length ? `${tag}${classes.map((c) => `.${escapeIdent(c)}`).join('')}` : `${tag}:nth-of-type(${info.nth})`;
}

export function selectorFor(chain: ElementInfo[], levels: number): string {
  const parts: string[] = [];
  for (const info of chain.slice(0, Math.max(1, levels))) {
    const part = simpleSelector(info);
    parts.unshift(part);
    if (part.startsWith('#')) break;
  }
  return parts.join(' > ');
}

export function addHideFilter(myFilters: string, host: string, selector: string): string {
  const line = `${host}##${selector}`;
  const base = myFilters.replace(/\n+$/, '');
  if (base.split('\n').includes(line)) return base;
  return base ? `${base}\n${line}` : line;
}

export interface Pick {
  host: string;
  selector: string;
}

const MAX_SELECTOR = 1000;
const IDENT = '[A-Za-z_\\u0080-\\uFFFF-][\\w\\u0080-\\uFFFF-]*';
const COMPOUND = `(?:#[A-Za-z][\\w-]*|${IDENT}(?:(?:\\.${IDENT})+|:nth-of-type\\(\\d+\\)))`;
const ESCAPE = /\\[0-9a-fA-F]{1,6} ?|\\[^\n]/g;
// Exactly what selectorFor builds: `#id`, `tag.class...` or `tag:nth-of-type(n)`, joined by ` > `, with escapes allowed. Nothing else gets in, not even a bare tag.
// A last compound on html or body is refused as well, however it is spelled: `\68 tml` and `\html` are html to CSS, so escapes are decoded for that test.
const BUILT = new RegExp(`^${COMPOUND}(?: > ${COMPOUND})*$`);

// What an escape stands for in a name, if it is a letter (hex `\62 ` and `\c` both give the letter); anything else cannot help spell html or body, so it stays `x`.
function escapedLetter(escape: string): string {
  const code = /^\\[0-9a-fA-F]/.test(escape) ? parseInt(escape.slice(1), 16) : (escape.codePointAt(1) as number);
  return code < 0x80 && /[A-Za-z]/.test(String.fromCharCode(code)) ? String.fromCharCode(code) : 'x';
}

function isBuiltSelector(selector: string): boolean {
  if (selector.length > MAX_SELECTOR || /[\u0000-\u001f\u007f]/.test(selector)) return false;
  const plain = selector.replace(ESCAPE, escapedLetter);
  return BUILT.test(plain) && !/^(?:html|body)[.:]/i.test(plain.split(' > ').pop() as string);
}

// The message comes from a page we do not control, so the host is the sender's full hostname (www. kept, so www.google.com never hides on mail.google.com), never the message's.
export function parsePick(message: unknown, senderUrl: string | undefined): Pick | null {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return null;
  const { type, host, selector } = message as Record<string, unknown>;
  if (type !== 'pick' || typeof host !== 'string' || host.length > 253 || typeof selector !== 'string' || !isBuiltSelector(selector)) return null;
  const page = senderUrl === undefined ? null : pageUrl(senderUrl);
  const hostname = page === null ? '' : new URL(page).hostname.replace(/\.$/, '');
  return isHost(hostname) ? { host: hostname, selector } : null;
}
