import { selectorFor, type ElementInfo } from '@apps-hub/sieve-core/src/picker.ts';
import base from '../../../packages/ui/web/base.css';
import tokens from '../../../packages/ui/web/tokens.css';
import { h } from './dom.ts';

const LOCAL_CSS = `
[hidden] { display: none !important; }
.root { color: var(--c-text); font: var(--type-body) var(--font-sans); }
.box { position: fixed; box-sizing: border-box; border: 2px solid var(--c-accent); border-radius: 2px; background: var(--c-accent-soft); pointer-events: none; }
.panel { position: fixed; right: var(--space-lg); bottom: var(--space-lg); display: grid; gap: var(--space-sm); width: min(360px, calc(100vw - 2 * var(--space-lg))); padding: var(--space-md); pointer-events: auto; }
.panel p { margin: 0; }
.selector { padding: var(--space-sm); border-radius: var(--radius-control); background: var(--c-raised); overflow-wrap: anywhere; font: var(--type-data) var(--font-mono); }
.error { color: var(--c-danger); font: 600 var(--type-meta) var(--font-sans); }
.row { display: flex; flex-wrap: wrap; gap: var(--space-sm); }
.row .gap { flex: 1; }
`;

const KEY = 'sievePicker';
const store = globalThis as unknown as Record<string, (() => void) | undefined>;
store[KEY]?.();

const ac = new AbortController();
let closed = false;
let hovered: Element | null = null;
let target: Element | null = null;
let chain: ElementInfo[] = [];
let levels = 1;
let selector = '';
let busy = false;

const host = document.createElement('sieve-picker');
for (const [name, value] of Object.entries({ all: 'initial', position: 'fixed', inset: '0', 'z-index': '2147483647', 'pointer-events': 'none' })) host.style.setProperty(name, value, 'important');
const sheet = new CSSStyleSheet();
// A page cannot load the vendored fonts, so the system font stands in; `:root` matches nothing inside a shadow root, `:host` does.
sheet.replaceSync(tokens.replace(/@font-face\s*\{[^}]*\}/g, '').replace(':root', ':host') + base + LOCAL_CSS);
const shadow = host.attachShadow({ mode: 'open' });
shadow.adoptedStyleSheets = [sheet];

// The page can reach an open shadow root and call click() on a button in it; only real input may confirm.
const real = (fn: () => void) => (e: Event) => {
  if (e.isTrusted) fn();
};
const button = (text: string, onclick: () => void, extra = '') => h('button', { class: `ui-btn${extra}`, type: 'button', onclick: real(onclick) }, text);

const box = h('div', { class: 'box', hidden: true });
const hint = h('p', { class: 'ui-meta' }, 'Click the item you want to block. Esc cancels.');
const code = h('code', { class: 'selector', hidden: true });
const count = h('p', { class: 'ui-heading', hidden: true, 'aria-live': 'polite' });
const error = h('p', { class: 'error', role: 'alert', hidden: true });
const less = button('Less', () => ((levels -= 1), show()));
const more = button('More', () => ((levels += 1), show()));
const cancel = button('Cancel', close);
const block = button('Block it', () => void send(), ' ui-btn--primary');
const choice = [less, more, block];
const panel = h('section', { class: 'panel ui-group', role: 'dialog', 'aria-label': 'Block an item on this page' }, hint, code, count, error, h('div', { class: 'row' }, less, more, h('span', { class: 'gap' }), cancel, block));
shadow.append(h('div', { class: 'root', 'data-brand': 'sieve' }, box, panel));
// A page handler that closes its menu on any outside click must not hear the owner using the panel.
for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const) shadow.addEventListener(type, (e) => e.stopPropagation());

function matches(sel: string): Element[] {
  try {
    return [...document.querySelectorAll(sel)];
  } catch {
    return [];
  }
}

function info(el: Element): ElementInfo {
  const nth = [...(el.parentElement?.children ?? [el])].filter((c) => c.localName === el.localName).indexOf(el) + 1;
  return { tag: el.localName, id: el.getAttribute('id') ?? '', classes: [...el.classList], nth };
}

function outline(el: Element | null): void {
  box.hidden = el === null;
  if (el === null) return;
  const r = el.getBoundingClientRect();
  Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
}

function show(): void {
  selector = target === null ? '' : selectorFor(chain, levels);
  const n = matches(selector).length;
  hint.hidden = target !== null;
  code.hidden = count.hidden = target === null;
  for (const b of choice) b.hidden = target === null;
  code.textContent = selector;
  count.textContent = `Hides ${n} ${n === 1 ? 'item' : 'items'} on this page`;
  less.disabled = levels <= 1;
  more.disabled = selectorFor(chain, levels + 1) === selector;
  block.disabled = busy || n === 0;
  outline(target ?? hovered);
}

function choose(el: Element): void {
  target = el;
  chain = [];
  for (let e: Element | null = el; e !== null && e !== document.documentElement; e = e.parentElement) chain.push(info(e));
  // The shortest selector that finds only this item or starts at an id; failing that, the shortest one that finds the fewest.
  levels = 1;
  let fewest = Infinity;
  for (let n = 1; n <= chain.length; n++) {
    const sel = selectorFor(chain, n);
    const found = matches(sel).length;
    if (sel.startsWith('#') || found === 1) {
      levels = n;
      break;
    }
    if (found > 0 && found < fewest) [fewest, levels] = [found, n];
  }
  error.hidden = true;
  show();
  block.focus();
}

function fail(text: string): void {
  busy = false;
  error.textContent = text;
  error.hidden = false;
  show();
}

async function send(): Promise<void> {
  if (busy) return;
  busy = true;
  error.hidden = true;
  show();
  let reply: { ok?: boolean } | undefined;
  try {
    reply = await chrome.runtime.sendMessage({ type: 'pick', host: location.hostname, selector });
  } catch {
    // After the extension reloads, this page's copy of the picker is cut off and sendMessage throws at once.
    if (!closed) fail('Sieve was reloaded or turned off. Reload this page, then try again.');
    return;
  }
  if (closed) return;
  if (reply?.ok === true) return close();
  fail("Sieve couldn't block this item. Reload this page, then try again.");
}

function close(): void {
  closed = true;
  ac.abort();
  host.remove();
  delete store[KEY];
}

const pickable = (el: EventTarget | null): el is Element => el instanceof Element && el !== document.documentElement && el !== document.body;
// A page that removes the picker must not leave listeners behind that swallow its clicks.
const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) =>
  window.addEventListener(type, (e) => (host.isConnected ? fn(e) : close()), { capture: true, signal: ac.signal });
const inside = (e: Event) => e.composedPath().includes(host);

on('mousemove', (e) => {
  if (inside(e) || target !== null) return;
  hovered = pickable(e.target) ? e.target : null;
  outline(hovered);
});
for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu'] as const) {
  on(type, (e) => {
    if (inside(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (type === 'click' && e.isTrusted && e.button === 0 && pickable(e.target)) choose(e.target);
  });
}
on('keydown', (e) => {
  if (e.key !== 'Escape' || !e.isTrusted) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  close();
});
on('scroll', () => outline(target ?? hovered));
on('resize', () => outline(target ?? hovered));

store[KEY] = close;
document.documentElement.append(host);
show();
