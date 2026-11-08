import { DYNAMIC_RULESET } from '@apps-hub/sieve-core/src/counts.ts';
import { h } from './dom.ts';
import { NAMES } from './lists.ts';
import { MAX_ROWS, addRow, afterDrop, filterSources, listName, type Row } from './panel-log.ts';

const COLUMNS = ['Time', 'Type', 'Address', 'List', 'Filter'];
const SETTLE_MS = 500;
const GRACE_MS = 1000;

const asked = new URLSearchParams(location.search).get('tab') ?? chrome.devtools?.inspectedWindow?.tabId;
const tabId = asked ? Number(asked) : NaN;

// DevTools has its own theme, which the page's own colour scheme may not match.
const setTheme = (name: string) => void (document.documentElement.dataset.theme = name === 'dark' ? 'dark' : 'light');
if (chrome.devtools) {
  setTheme(chrome.devtools.panels.themeName);
  chrome.devtools.panels.setThemeChangeHandler?.(setTheme);
}

const sources = filterSources(async (rulesetId) => {
  if (rulesetId === DYNAMIC_RULESET) return (await chrome.storage.local.get('myRuleSources')).myRuleSources ?? {};
  if (!Object.hasOwn(NAMES, rulesetId)) return {};
  const res = await fetch(`sources/${rulesetId}.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'myRuleSources' in changes) sources.forget(DYNAMIC_RULESET);
});

const rows: Row[] = [];
let dropped = false;
// 'retrying' is silent: Chrome stops an idle worker about every 30 seconds and the panel connects again at once. 'lost' says so, once that has taken GRACE_MS.
let link: 'up' | 'retrying' | 'lost' | 'gone' = 'up';

function statusText(): string {
  if (!Number.isInteger(tabId)) return 'Open Sieve from the tab bar in DevTools.';
  if (link === 'gone') return 'Sieve stopped. Close and reopen DevTools, or reload the extension.';
  if (link === 'lost') return "Sieve is reconnecting. Requests blocked meanwhile won't be listed.";
  if (rows.length === 0) return 'Reload the page to see what Sieve blocks.';
  return dropped ? `Showing the latest ${MAX_ROWS} requests.` : '';
}

const status = h('p', { class: 'ui-meta status', role: 'status' });
const body = h('tbody');
const table = h('div', { class: 'ui-group table' }, h('table', { 'aria-label': 'Blocked requests' }, h('thead', {}, h('tr', {}, ...COLUMNS.map((c) => h('th', { scope: 'col' }, c)))), body));
const rowEl = (r: Row) =>
  h('tr', {}, h('td', { class: 'ui-mono' }, new Date(r.at).toTimeString().slice(0, 8)), h('td', {}, r.type), h('td', { title: r.url }, r.url), h('td', {}, r.list), h('td', { class: 'ui-mono' }, r.filter));

function render(): void {
  const text = statusText();
  if (status.textContent !== text) status.textContent = text;
  table.hidden = rows.length === 0;
}

// Rows are added to the table one at a time, so a selection in it survives. The page follows new rows only if it was at the bottom before this batch.
let drawing = false;
function draw(): void {
  if (drawing) return;
  drawing = true;
  const page = document.scrollingElement!;
  const stick = page.scrollTop + page.clientHeight >= page.scrollHeight - 4;
  setTimeout(() => {
    drawing = false;
    render();
    if (stick) page.scrollTop = page.scrollHeight;
  }, 0);
}

type Message = Partial<{ reset: boolean; url: string; type: string; rulesetId: string; ruleId: number; at: number }> | null;

// One chain, so a row waiting for its list's filter text never lets a later row or a reset overtake it.
let chain: Promise<void> = Promise.resolve();
function onMessage(message: unknown): void {
  chain = chain
    .then(async () => {
      const m = message as Message;
      if (m?.reset === true) {
        draw();
        rows.length = 0;
        dropped = false;
        body.replaceChildren();
      } else if (typeof m?.url === 'string' && typeof m.type === 'string' && typeof m.rulesetId === 'string' && typeof m.ruleId === 'number' && typeof m.at === 'number') {
        const row = { at: m.at, type: m.type, url: m.url, list: listName(m.rulesetId), filter: await sources.get(m.rulesetId, m.ruleId) };
        draw();
        const older = addRow(rows, row);
        body.append(rowEl(row));
        if (older) body.firstElementChild!.remove();
        dropped ||= older;
      }
      draw();
    })
    .catch((e) => console.error('Sieve could not list a blocked request', e));
}

let quickDrops = 0;
let lostTimer: ReturnType<typeof setTimeout> | undefined;

function settle(): void {
  clearTimeout(lostTimer);
  if (link === 'retrying' || link === 'lost') link = 'up';
  draw();
}

function stop(): void {
  clearTimeout(lostTimer);
  link = 'gone';
  draw();
}

function connect(): void {
  let port: chrome.runtime.Port;
  try {
    port = chrome.runtime.connect({ name: `panel:${tabId}` });
  } catch {
    return stop();
  }
  const born = Date.now();
  let received = false;
  const settled = setTimeout(settle, SETTLE_MS);
  port.onMessage.addListener((message) => {
    received = true;
    settle();
    onMessage(message);
  });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    clearTimeout(settled);
    const next = afterDrop(quickDrops, Date.now() - born, received);
    quickDrops = next.quickDrops;
    if (next.retryMs === null) return stop();
    if (link === 'up') {
      link = 'retrying';
      lostTimer = setTimeout(() => {
        if (link === 'retrying') link = 'lost';
        draw();
      }, GRACE_MS);
    }
    setTimeout(connect, next.retryMs);
  });
}

document.getElementById('app')!.replaceChildren(status, table);
render();
if (Number.isInteger(tabId)) connect();
