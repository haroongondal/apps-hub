import { DYNAMIC_RULESET } from '@apps-hub/sieve-core/src/counts.ts';
import { h } from './dom.ts';
import { NAMES } from './lists.ts';
import { MAX_ROWS, addRow, filterSources, listName, type Row } from './panel-log.ts';

const COLUMNS = ['Time', 'Type', 'Address', 'List', 'Filter'];
const RECONNECT_MS = 250;

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
let link: 'up' | 'retrying' | 'gone' = 'up';

function statusText(): string {
  if (!Number.isInteger(tabId)) return 'Open Sieve from the tab bar in DevTools.';
  if (link === 'gone') return 'Sieve was reloaded or turned off. Close DevTools and open it again.';
  if (link === 'retrying') return "Sieve is reconnecting. Requests blocked meanwhile won't be listed.";
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
  const page = document.scrollingElement!;
  const atBottom = page.scrollTop + page.clientHeight >= page.scrollHeight - 4;
  body.replaceChildren(...rows.map(rowEl));
  if (atBottom) page.scrollTop = page.scrollHeight;
}

let drawing = false;
function draw(): void {
  if (drawing) return;
  drawing = true;
  setTimeout(() => {
    drawing = false;
    render();
  }, 0);
}

// One chain, so a row waiting for its list's filter text never lets a later row or a reset overtake it.
let chain: Promise<void> = Promise.resolve();
function onMessage(message: unknown): void {
  chain = chain.then(async () => {
    const m = message as Partial<{ reset: boolean; url: string; type: string; rulesetId: string; ruleId: number; at: number }> | null;
    if (m?.reset === true) {
      rows.length = 0;
      dropped = false;
    } else if (typeof m?.url === 'string' && typeof m.type === 'string' && typeof m.rulesetId === 'string' && typeof m.ruleId === 'number' && typeof m.at === 'number') {
      const filter = await sources.get(m.rulesetId, m.ruleId);
      dropped = addRow(rows, { at: m.at, type: m.type, url: m.url, list: listName(m.rulesetId), filter }) || dropped;
    }
    draw();
  });
}

function connect(): void {
  let port: chrome.runtime.Port;
  try {
    port = chrome.runtime.connect({ name: `panel:${tabId}` });
  } catch {
    link = 'gone';
    return draw();
  }
  link = 'up';
  draw();
  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    link = 'retrying';
    draw();
    setTimeout(connect, RECONNECT_MS);
  });
}

document.getElementById('app')!.replaceChildren(status, table);
render();
if (Number.isInteger(tabId)) connect();
