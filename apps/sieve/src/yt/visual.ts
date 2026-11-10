import { backdropColor, filterCss, flipTransform } from '@apps-hub/sieve-core/src/visual.ts';
import { DEFAULT_YOUTUBE, YOUTUBE_GROUPS, type VideoFilters, type YouTubeSettings } from '@apps-hub/sieve-core/src/youtube-settings.ts';
import { h } from '../dom.ts';
import SWITCH_CSS from '../switch.css';
import { defineAction, notifyActions, runAction } from './actions.ts';
import { addStyle, currentPage, feature, onNavigate, onSettings, saveYouTube, setFlag } from './bridge.ts';
import { addButton, toast } from './row.ts';
import { NAV, SEL, THEATER_ATTR } from './selectors.ts';
import VISUAL_CSS from './visual.css';

// inspected 2026-11-10, signed out, Chrome for Testing 149.0.7827.55: fixed layers sit at z-index 2020 (masthead), 2028 (mini guide), 2030 (guide drawer, miniplayer), 2031 (persistent panel), 2100 (progress bar), 20000 (snackbar); visual.css puts the backdrop at 2200 and what it lifts at 2201.
// Nothing between `body` and #player-container, #full-bleed-container or ytd-watch-metadata makes a stacking context (no transform, opacity, contain or z-index), so z-index on them reaches the root context. #player-container is position absolute, #full-bleed-container static (0 px tall) in default layout and relative in theater.
type FilterKey = keyof VideoFilters;
const FILTER_FIELDS = (YOUTUBE_GROUPS.find((g) => g.id === 'player')?.fields ?? []).flatMap((f) =>
  f.kind === 'number' && f.path.startsWith('player.filters.') ? [{ key: f.path.slice('player.filters.'.length) as FilterKey, label: f.label, min: f.min, max: f.max, step: f.step, unit: f.unit ?? '' }] : [],
);
const shown = (v: number, unit: string): string => `${v}${unit === 'px' ? ' px' : unit}`;
const SAVE_AFTER_MS = 150;

let y: YouTubeSettings = DEFAULT_YOUTUBE;
let on = false;
let flipH = false;
let flipV = false;
let videoId: string | null = null;
let live: VideoFilters | null = null;
let backdrop: HTMLElement | null = null;
let theaterFor = '';
let finished = false;
let patch: { player: { filters: Partial<VideoFilters> } } | null = null;
let patchTimer: ReturnType<typeof setTimeout> | undefined;
let wasExpand = false;

const root = document.documentElement;
const watching = (): boolean => on && window === window.top && currentPage().kind === 'watch';

async function save(p: unknown): Promise<void> {
  const r = await saveYouTube(p);
  if (!r.ok) toast(r.message ?? 'Sieve could not save the setting. Reload the page, then try again.');
}

function mountBackdrop(): void {
  if (backdrop?.isConnected) return;
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', mountBackdrop, { once: true });
    return;
  }
  backdrop ??= h('sieve-yt-backdrop' as 'div', { onclick: (e: Event) => e.isTrusted && void save({ player: { cinema: false } }) });
  document.body.append(backdrop);
}

// Slider changes within SAVE_AFTER_MS become one write (a held arrow key fires `change` per step); a page that unloads first sends it at once.
function saveFilters(key: FilterKey, value: number): void {
  patch = { player: { filters: { ...patch?.player.filters, [key]: value } } };
  clearTimeout(patchTimer);
  patchTimer = setTimeout(flush, SAVE_AFTER_MS);
}
function flush(): void {
  clearTimeout(patchTimer);
  if (patch) void save(patch);
  patch = null;
}
window.addEventListener('pagehide', flush);
(NAV.target === 'window' ? window : document).addEventListener(NAV.finish, () => (finished = true), true);

// inspected 2026-11-10, signed out, Chrome for Testing 149.0.7827.55: the theater player's height is limited by #full-bleed-container, which YouTube gives height 56.25vw, max-height calc(100vh - 169px) and min-height 480px (631 px at 800 px of viewport).
// The override in visual.css (height calc(100vh - 56px), max-height none, min-height 0) gave 744 px at 800. The size button is in the DOM about 2.8 s into a hard load, before its click handler can be relied on, and yt-navigate-finish comes 2.2 s later.
// So the size button, which toggles, is clicked only after a yt-navigate-finish, and once per address (a hard load runs this twice for the same one).
function ensureTheater(): void {
  if (!finished || !watching() || !(y.player.autoTheater || y.player.expand) || theaterFor === location.href) return;
  const flexy = document.querySelector(SEL.watch);
  const button = document.querySelector<HTMLElement>(SEL.sizeButton);
  if (!flexy || !button) return;
  theaterFor = location.href;
  if (!flexy.hasAttribute(THEATER_ATTR)) button.click();
}

// inspected 2026-11-10, signed out, Chrome for Testing 149.0.7827.55: the video's inline style is only width, height, left and top, and 2.5 s of a rate change and a seek added none; no YouTube rule sets transform or filter on it. So a plain rule in visual.css wins.
function setFlip(): void {
  document.querySelector<HTMLElement>(SEL.player)?.style.setProperty('--sieve-yt-flip', flipTransform(flipH, flipV));
  setFlag('flip', on && (flipH || flipV));
}

function setFilters(): void {
  root.style.setProperty('--sieve-yt-filter', filterCss(live ?? y.player.filters));
  setFlag('filters', on && y.player.filtersOn);
}

function render(): void {
  if (!on) {
    for (const flag of ['cinema', 'expand', 'flip', 'filters']) setFlag(flag, false);
    for (const p of ['--sieve-yt-backdrop', '--sieve-yt-filter']) root.style.removeProperty(p);
    document.querySelector<HTMLElement>(SEL.player)?.style.removeProperty('--sieve-yt-flip');
  } else {
    if (live && filterCss(live) === filterCss(y.player.filters)) live = null;
    const cinema = watching() && y.player.cinema;
    if (cinema) mountBackdrop();
    root.style.setProperty('--sieve-yt-backdrop', backdropColor(y.player.backdrop, y.player.backdropOpacity));
    setFlag('cinema', cinema);
    setFlag('expand', watching() && y.player.expand);
    setFlip();
    setFilters();
  }
  const expand = watching() && y.player.expand;
  if (expand && !wasExpand) theaterFor = '';
  if (expand) ensureTheater();
  if (expand !== wasExpand) {
    wasExpand = expand;
    // inspected 2026-11-10, signed out, Chrome for Testing 149.0.7827.55: after the box height changed, the video's inline width, height and left stayed (1122x631) until a synthetic `resize` event on window made YouTube lay it out again (747x420).
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
}

function switchRow(text: string, checked: boolean, change: (on: boolean) => void): HTMLLabelElement {
  const input: HTMLInputElement = h('input', { type: 'checkbox', role: 'switch', checked, onchange: (e: Event) => e.isTrusted && change(input.checked) });
  return h('label', { class: 'switch' }, h('span', {}, text), input);
}

const POP_CSS = `${SWITCH_CSS}
.pop.opts { min-width: 300px; }
.slider { display: grid; grid-template-columns: 88px 1fr 56px; align-items: center; gap: var(--space-sm); min-height: 32px; }
.slider input { width: 100%; accent-color: var(--c-accent); }
.slider output { text-align: right; color: var(--c-muted); font: var(--type-caption) var(--font-mono); }`;

function filterOptions(): HTMLElement {
  const values = { ...(live ?? y.player.filters) };
  const sliders = FILTER_FIELDS.map((f) => {
    const out = h('output', {}, shown(values[f.key], f.unit));
    const input: HTMLInputElement = h('input', {
      type: 'range',
      min: String(f.min),
      max: String(f.max),
      step: String(f.step),
      value: String(values[f.key]),
      'aria-label': f.label,
      'aria-valuetext': shown(values[f.key], f.unit),
      oninput: (e: Event) => {
        if (!e.isTrusted) return;
        values[f.key] = Number(input.value);
        live = { ...values };
        out.textContent = shown(values[f.key], f.unit);
        input.setAttribute('aria-valuetext', out.textContent);
        setFilters();
      },
      onchange: (e: Event) => e.isTrusted && saveFilters(f.key, Number(input.value)),
    });
    return { f, input, out, row: h('label', { class: 'slider' }, h('span', {}, f.label), input, out) };
  });
  const reset = h('button', {
    type: 'button',
    class: 'ui-btn',
    onclick: (e: Event) => {
      if (!e.isTrusted) return;
      patch = null;
      clearTimeout(patchTimer);
      live = { ...DEFAULT_YOUTUBE.player.filters };
      setFilters();
      for (const s of sliders) {
        s.input.value = String(live[s.f.key]);
        s.out.textContent = shown(live[s.f.key], s.f.unit);
        s.input.setAttribute('aria-valuetext', s.out.textContent);
      }
      void save({ player: { filters: DEFAULT_YOUTUBE.player.filters } });
    },
  }, 'Reset');
  return h('div', { class: 'opts' }, h('style', {}, POP_CSS), switchRow('Filters on', y.player.filtersOn, (v) => void save({ player: { filtersOn: v } })), ...sliders.map((s) => s.row), reset);
}

function flipOptions(): HTMLElement {
  return h('div', { class: 'opts' }, h('style', {}, POP_CSS), switchRow('Flip horizontally', flipH, () => void runAction('flip-h')), switchRow('Flip vertically', flipV, () => void runAction('flip-v')));
}

feature('cinema, expand, flip and filters', () => {
  addStyle(VISUAL_CSS.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => (SEL as Record<string, string>)[k] ?? ''));

  const toggle = (key: 'cinema' | 'expand' | 'filtersOn') => () => save({ player: { [key]: !y.player[key] } });
  defineAction('cinema', toggle('cinema'), () => y.player.cinema);
  defineAction('expand', toggle('expand'), () => y.player.expand);
  defineAction('filters', toggle('filtersOn'), () => y.player.filtersOn);
  defineAction('flip-h', () => ((flipH = !flipH), setFlip(), notifyActions()), () => flipH);
  defineAction('flip-v', () => ((flipV = !flipV), setFlip(), notifyActions()), () => flipV);

  addButton({ id: 'cinema', label: 'Cinema', pressed: () => y.player.cinema, onClick: () => void runAction('cinema') });
  addButton({ id: 'expand', label: 'Expand', pressed: () => y.player.expand, onClick: () => void runAction('expand') });
  addButton({ id: 'filters', label: 'Filters', pressed: () => y.player.filtersOn, onClick: () => void runAction('filters'), menu: { label: 'Filter options', build: filterOptions } });
  addButton({ id: 'flip', label: 'Flip', pressed: () => flipH, onClick: () => void runAction('flip-h'), menu: { label: 'Flip options', build: flipOptions } });

  onSettings((next, isOn) => {
    y = next;
    on = isOn;
    render();
    notifyActions();
  });
  onNavigate((p) => {
    if (p.videoId !== videoId) {
      videoId = p.videoId;
      flipH = flipV = false;
    }
    render();
    if (watching() && y.player.autoTheater) ensureTheater();
    notifyActions();
  });
});
