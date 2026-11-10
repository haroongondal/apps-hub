import { ROW_ORDER } from '@apps-hub/sieve-core/src/yt-actions.ts';
import base from '../../../../packages/ui/web/base.css';
import tokens from '../../../../packages/ui/web/tokens.css';
import { h } from '../dom.ts';
import { onActionsChanged } from './actions.ts';
import { currentPage, feature, onNavigate, onSettings } from './bridge.ts';
import LOCAL_CSS from './row.css';
import { DARK_ATTR, SEL } from './selectors.ts';

export interface RowButton {
  id: string;
  label: string | (() => string);
  title?: string;
  ariaLabel?: string | (() => string);
  icon?: () => SVGElement;
  pressed?: () => boolean;
  onClick: () => void;
  menu?: { label: string; build: () => HTMLElement };
}
type MenuItem = { id: string; label: string; onClick: () => void; visible?: () => boolean; checked?: () => boolean };

const NS = 'http://www.w3.org/2000/svg';
const svg = (...shapes: [string, Record<string, string>][]): SVGElement => {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of shapes) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    s.append(el);
  }
  return s;
};
const cog = () => svg(['circle', { cx: '12', cy: '12', r: '8.6', 'stroke-width': '3', 'stroke-dasharray': '3.4 3.35' }], ['circle', { cx: '12', cy: '12', r: '5.9', 'stroke-width': '2.6' }]);
const chevron = () => svg(['path', { d: 'M7 10l5 5 5-5' }]);

const real = <E extends Event>(fn: (e: E) => void) => (e: E) => {
  if (e.isTrusted) fn(e);
};
const text = (v: string | (() => string)): string => (typeof v === 'function' ? v() : v);

const rendered: { b: RowButton; item: HTMLElement; main: HTMLButtonElement }[] = [];
const items: { m: MenuItem; el: HTMLButtonElement }[] = [];
const bar = h('div', { class: 'bar ui-toolbar' });
const status = h('p', { class: 'toast ui-meta', role: 'status' });
const settingsItem = h('button', { type: 'button', class: 'ui-btn ui-btn--ghost', role: 'menuitem', onclick: real(openSettings) }, 'Sieve settings');
const menu = h('div', { class: 'menu', role: 'menu', 'aria-label': 'More and settings' }, settingsItem);

let host: HTMLElement | null = null;
let wrap: HTMLElement | null = null;
let on = false;
let open: { pop: HTMLElement; opener: HTMLButtonElement } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let deadline = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function paint({ b, main }: (typeof rendered)[number]): void {
  const label = text(b.label);
  if (b.icon) main.title = b.title ?? label;
  else {
    main.textContent = label;
    if (b.title) main.title = b.title;
  }
  const aria = b.ariaLabel ? text(b.ariaLabel) : b.icon ? label : null;
  if (aria) main.setAttribute('aria-label', aria);
  if (b.title) main.setAttribute('aria-description', b.title);
  if (b.pressed) main.setAttribute('aria-pressed', String(b.pressed()));
}

export function addButton(b: RowButton): void {
  const order = ROW_ORDER.indexOf(b.id);
  if (order < 0) throw new Error(`Sieve: ${b.id} is not a row button`);
  const main = h('button', { type: 'button', class: `ui-btn${b.icon ? ' ui-btn--icon' : ''}`, onclick: real(b.onClick) });
  if (b.icon) main.append(b.icon());
  const item = h('span', { class: `item${b.menu ? ' split' : ''}`, 'data-id': b.id }, main);
  if (b.menu) {
    const { label, build } = b.menu;
    const arrow: HTMLButtonElement = h('button', { type: 'button', class: 'ui-btn arrow', 'aria-label': label, 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: real(() => toggle(arrow, build)) }, chevron());
    item.append(arrow);
  }
  const r = { b, item, main };
  paint(r);
  bar.insertBefore(item, rendered.find((x) => ROW_ORDER.indexOf(x.b.id) > order)?.item ?? null);
  rendered.push(r);
}

export function addMenuItem(m: MenuItem): void {
  const el = h('button', { type: 'button', class: 'ui-btn ui-btn--ghost', role: m.checked ? 'menuitemcheckbox' : 'menuitem', onclick: real(() => (close(), m.onClick())) }, m.label);
  items.push({ m, el });
  settingsItem.before(el);
}

export function refreshRow(): void {
  for (const r of rendered) paint(r);
  for (const { m, el } of items) {
    el.hidden = m.visible ? !m.visible() : false;
    if (m.checked) el.setAttribute('aria-checked', String(m.checked()));
  }
}

export function toast(line: string): void {
  status.textContent = line;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (status.textContent = ''), 2000);
}

export function rowElement(id: string): HTMLElement | null {
  return rendered.find((r) => r.b.id === id)?.main ?? null;
}

function toggle(opener: HTMLButtonElement, build: () => HTMLElement): void {
  const again = open?.opener === opener;
  close();
  if (again) return;
  const pop = build();
  pop.classList.add('pop', 'ui-sheet');
  opener.parentElement?.append(pop);
  opener.setAttribute('aria-expanded', 'true');
  open = { pop, opener };
  document.addEventListener('pointerdown', outside, true);
  const first = pop.querySelector<HTMLElement>('button:not([hidden]), input, select, textarea, [tabindex]');
  if (first) first.focus();
  else {
    pop.tabIndex = -1;
    pop.focus();
  }
}

function close(): void {
  if (!open) return;
  const { pop, opener } = open;
  open = null;
  document.removeEventListener('pointerdown', outside, true);
  pop.remove();
  opener.setAttribute('aria-expanded', 'false');
  opener.focus();
}

const outside = real((e: PointerEvent) => {
  const path = e.composedPath();
  if (open && !path.includes(open.pop) && !path.includes(open.opener)) close();
});

function openSettings(): void {
  close();
  try {
    // The worker opens the tab and never answers, so the "message port closed" rejection is expected.
    chrome.runtime.sendMessage({ type: 'open-settings', section: 'youtube' }).catch(() => {});
  } catch {
    toast('Sieve was reloaded or turned off. Reload this page, then try again.');
  }
}

const setTheme = (): void => {
  if (wrap) wrap.dataset.theme = document.documentElement.hasAttribute(DARK_ATTR) ? 'dark' : 'light';
};
const themeWatch = new MutationObserver(setTheme);
const parentWatch = new MutationObserver(() => ensureMounted());

function build(): HTMLElement {
  host = document.createElement('sieve-yt-row');
  const sheet = new CSSStyleSheet();
  // A page cannot load the vendored fonts, so the system font stands in; `:root` matches nothing inside a shadow root, `:host` does.
  sheet.replaceSync(tokens.replace(/@font-face\s*\{[^}]*\}/g, '').replace(':root', ':host') + base + LOCAL_CSS);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.adoptedStyleSheets = [sheet];
  wrap = h('div', { class: 'row', 'data-brand': 'sieve' }, bar, status);
  shadow.append(wrap);
  for (const type of ['keydown', 'keypress', 'keyup'] as const) {
    shadow.addEventListener(type, (e) => {
      e.stopPropagation();
      if (e.isTrusted && type === 'keydown' && (e as KeyboardEvent).key === 'Escape') close();
    });
  }
  return host;
}

function stopRetry(): void {
  clearTimeout(timer);
  timer = undefined;
  deadline = 0;
}

function stop(): void {
  stopRetry();
  parentWatch.disconnect();
  themeWatch.disconnect();
}

function ensureMounted(): void {
  if (!on || window !== window.top || currentPage().kind !== 'watch') return;
  const anchor = document.querySelector(SEL.rowAnchor);
  if (!anchor?.parentElement) {
    deadline ||= Date.now() + 10_000;
    if (timer === undefined && Date.now() < deadline) {
      timer = setTimeout(() => {
        timer = undefined;
        ensureMounted();
      }, 100);
    }
    return;
  }
  stopRetry();
  const el = host ?? build();
  el.hidden = false;
  if (anchor.previousElementSibling !== el) {
    anchor.before(el);
    el.dataset.mounts = String(Number(el.dataset.mounts ?? 0) + 1);
  }
  parentWatch.disconnect();
  parentWatch.observe(anchor.parentElement, { childList: true });
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: [DARK_ATTR] });
  setTheme();
}

feature('the button row', () => {
  addButton({ id: 'settings', label: 'More and settings', icon: cog, onClick: () => toggle(rowElement('settings') as HTMLButtonElement, () => (refreshRow(), menu)) });
  onActionsChanged(refreshRow);
  onSettings((_y, isOn) => {
    on = isOn;
    stop();
    if (on) ensureMounted();
    else if (host) {
      close();
      host.hidden = true;
    }
  });
  onNavigate(() => {
    stop();
    ensureMounted();
  });
});
