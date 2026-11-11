import { shortsToWatch } from '@apps-hub/sieve-core/src/tidy.ts';
import { DEFAULT_YOUTUBE, type YouTubeSettings } from '@apps-hub/sieve-core/src/youtube-settings.ts';
import type { YtPage } from '@apps-hub/sieve-core/src/yt-bridge.ts';
import { defineAction, notifyActions } from './actions.ts';
import { addStyle, currentPage, feature, onNavigate, onSettings, saveYouTube, setFlag, setStyle } from './bridge.ts';
import { toast } from './row.ts';
import { EXPANDED_ATTR, CAN_EXPAND_ATTR, PER_ROW_VAR, SELECTED_ATTR, SHORTS_GRID_ATTR, SUBTYPE, SUBTYPE_ATTR, TIDY_SEL } from './tidy-selectors.ts';
import TIDY_CSS from './tidy.css';

// The facts behind every selector here are recorded in tidy-selectors.ts.
const FLAGS = [
  ['hide-shorts', 'hideShorts'],
  ['hide-related', 'hideRelated'],
  ['hide-comments', 'hideComments'],
  ['hide-chat', 'hideChat'],
  ['hide-cards', 'hideCards'],
] as const;
const COMMENTS_MS = 60_000;
const EXPANDER_MS = 10_000;

let y: YouTubeSettings = DEFAULT_YOUTUBE;
let on = false;
let sortedFor = '';
let expandedFor = '';
let stops: (() => void)[] = [];

const watching = (p: YtPage): boolean => on && window === window.top && p.kind === 'watch' && p.videoId !== null;

// Runs `attempt` now and on every change under `root` until it returns true, `ms` pass, or the next navigation. Disconnects each time.
function until(root: Element, attributes: string[], ms: number, attempt: () => boolean): void {
  if (attempt()) return;
  const observer = new MutationObserver(() => attempt() && stop());
  const timer = setTimeout(stop, ms);
  function stop(): void {
    observer.disconnect();
    clearTimeout(timer);
  }
  stops.push(stop);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: attributes });
}

function pickNewest(p: YtPage): void {
  const box = document.querySelector(TIDY_SEL.comments);
  if (!y.tidy.newestComments || !watching(p) || !box || sortedFor === p.videoId) return;
  // Only when the list says Top is the chosen one: a header left from the last video, already on Newest, is waited out until the new one replaces it.
  until(box, [SELECTED_ATTR], COMMENTS_MS, () => {
    const items = box.querySelectorAll<HTMLElement>(TIDY_SEL.sortItems);
    if (items.length < 2 || items[0].getAttribute(SELECTED_ATTR) !== 'true') return false;
    items[1].click();
    sortedFor = p.videoId ?? '';
    return true;
  });
}

function expandDescription(p: YtPage): void {
  const area = document.querySelector(TIDY_SEL.below);
  if (!y.tidy.expandDescription || !watching(p) || !area || expandedFor === p.videoId) return;
  until(area, [EXPANDED_ATTR, CAN_EXPAND_ATTR], EXPANDER_MS, () => {
    const expander = area.querySelector(TIDY_SEL.expander);
    const button = expander?.querySelector<HTMLElement>(TIDY_SEL.expand);
    if (!expander || !button || expander.hasAttribute(EXPANDED_ATTR) || !expander.hasAttribute(CAN_EXPAND_ATTR)) return false;
    button.click();
    expandedFor = p.videoId ?? '';
    return true;
  });
}

function perRow(): string {
  const n = y.tidy.perRow;
  const rule = (sel: string, name: string, v: number): string => (v > 0 ? `${sel} { ${name}: ${v} !important; }\n` : '');
  const browse = (sub: string): string => `ytd-browse[${SUBTYPE_ATTR}="${sub}"] ${TIDY_SEL.grid}`;
  return (
    rule(browse(SUBTYPE.home), PER_ROW_VAR.items, n.home) +
    rule(`${browse(SUBTYPE.channel)}:not([${SHORTS_GRID_ATTR}])`, PER_ROW_VAR.items, n.channel) +
    rule(`${TIDY_SEL.grid}[${SHORTS_GRID_ATTR}]`, PER_ROW_VAR.slim, n.shorts) +
    rule(`html, ${TIDY_SEL.grid}`, PER_ROW_VAR.posts, n.posts)
  );
}

// The path and query only, so the page stays on its own origin (the local fixtures run on a port).
function watchPath(url: string): string | null {
  const to = shortsToWatch(url);
  if (!to) return null;
  const u = new URL(to);
  return u.pathname + u.search;
}

function toWatch(): void {
  if (!on || !y.tidy.convertShorts || window !== window.top) return;
  const to = watchPath(location.href);
  if (to) location.replace(to);
}

function run(): void {
  stops.forEach((s) => s());
  stops = [];
  const p = currentPage();
  toWatch();
  pickNewest(p);
  expandDescription(p);
}

async function toggle(key: 'hideComments' | 'hideRelated' | 'hideCards'): Promise<void> {
  const r = await saveYouTube({ tidy: { [key]: !y.tidy[key] } });
  if (!r.ok) toast(r.message ?? 'Sieve could not save the setting. Reload the page, then try again.');
}

feature('page tidying', () => {
  addStyle(TIDY_CSS);
  defineAction('comments', () => toggle('hideComments'), () => y.tidy.hideComments);
  defineAction('related', () => toggle('hideRelated'), () => y.tidy.hideRelated);
  defineAction('cards', () => toggle('hideCards'), () => y.tidy.hideCards);

  // A trusted click on a link to a Short goes to the watch page. A plain left click only: Ctrl, Shift and Alt clicks keep their own meaning.
  document.addEventListener(
    'click',
    (e) => {
      if (!e.isTrusted || !on || !y.tidy.convertShorts || window !== window.top || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const link = e.composedPath().find((n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement);
      const to = link && watchPath(link.href);
      if (!to) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      location.assign(to);
    },
    true,
  );

  onSettings((next, isOn) => {
    y = next;
    on = isOn;
    for (const [flag, key] of FLAGS) setFlag(flag, on && y.tidy[key]);
    setStyle('per-row', on ? perRow() : '');
    run();
    notifyActions();
  });
  onNavigate(run);
});
