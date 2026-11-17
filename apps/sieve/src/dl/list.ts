import type { DlRecord, DlState } from '@apps-hub/sieve-core/src/dl-record.ts';
import { CATEGORY_IDS, type DownloadSettings, type QueueSetting } from '@apps-hub/sieve-core/src/dl-settings.ts';
import { isOpen, nextChange } from '@apps-hub/sieve-core/src/dl-queue.ts';
import { T } from '@apps-hub/sieve-core/src/dl-text.ts';
import { etaSeconds, filterRecords, formatBytes, formatEta, formatSpeed, progressOf, sortRecords, statusText, type SidebarFilter, type SortKey } from '@apps-hub/sieve-core/src/dl-view.ts';
import { h } from '../dom.ts';
import { openAddDialog, STATUS_ID } from './add-dialog.ts';
import { readAllRecords } from './idb-store.ts';
import { openLimitDialog } from './limit-dialog.ts';
import { openSchedulerDialog } from './scheduler-dialog.ts';
import { onDownloadsChanged, readDownloads, saveDownloads } from './settings-store.ts';

document.title = T.listTitle;

const records = new Map<string, DlRecord>();
let speeds: Record<string, number> = {};
let total = 0;
let settings: DownloadSettings = await readDownloads();
let filter = 'all';
let sort: { key: SortKey; dir: 'asc' | 'desc' } = { key: 'added', dir: 'desc' };
const selected = new Set<string>();
let anchor: string | null = null;
let order: string[] = [];
let reorderedAt = 0;
let reorderTimer: ReturnType<typeof setTimeout> | undefined;

const send = (message: object): Promise<{ ok?: boolean; message?: string } | undefined> => chrome.runtime.sendMessage(message).catch(() => undefined);
const status = h('p', { id: STATUS_ID, class: 'dl-note', role: 'status' });
const say = (text: string) => (status.textContent = text);

async function command(op: 'pause' | 'resume' | 'remove', ids: string[]) {
  let failed: string | undefined;
  for (let i = 0; i < ids.length; i += 500) {
    const reply = await send({ type: 'dl-do', op, ids: ids.slice(i, i + 500) });
    if (!reply?.ok) failed ??= reply?.message ?? T.actionFailed;
  }
  if (ids.length > 0) say(failed ?? '');
}

const total$ = h('span', { class: 'ui-meta ui-mono dl-total', hidden: true });
const banner = h('div', { class: 'dl-banner ui-group', role: 'status', hidden: true }, h('p', {}, T.offBanner), h('button', { class: 'ui-btn', onclick: () => void saveDownloads((s) => ({ ...s, on: true })) }, T.turnOn));
const nav = h('nav', { class: 'dl-nav', 'aria-label': T.navLabel });
const tools = {
  add: h('button', { class: 'ui-btn ui-btn--primary', 'data-id': 'add', onclick: () => void openAddDialog().then(() => refresh(true)) }, T.addUrl),
  resume: h('button', { class: 'ui-btn', 'data-id': 'resume', onclick: () => void command('resume', pick(['paused', 'failed', 'queued'])) }, T.resume),
  pause: h('button', { class: 'ui-btn', 'data-id': 'pause', onclick: () => void command('pause', pick(['queued', 'running'])) }, T.pause),
  delete: h('button', { class: 'ui-btn ui-btn--danger', 'data-id': 'delete', onclick: () => confirmDelete() }, T.delete),
  speed: h('button', { class: 'ui-btn', 'data-id': 'speed', 'aria-pressed': 'false', onclick: () => openLimitDialog() }, T.speedLimit),
  scheduler: h('button', { class: 'ui-btn', 'data-id': 'scheduler', onclick: () => openSchedulerDialog() }, T.scheduler),
};
const toolbar = h('div', { class: 'ui-toolbar dl-toolbar', role: 'toolbar' }, ...Object.values(tools));

const COLUMNS: [SortKey, string][] = [['name', T.colName], ['size', T.colSize], ['progress', T.colProgress], ['speed', T.colSpeed], ['eta', T.colEta]];
const headers = new Map<SortKey, HTMLElement>();
const headRow = h('tr', {}, h('th', { class: 'dl-check' }));
for (const [key, label] of COLUMNS) {
  const th = h('th', { scope: 'col' }, h('button', { class: 'dl-sort', onclick: () => ((sort = sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }), refresh(true)) }, label));
  headers.set(key, th);
  headRow.append(th);
}
const tbody = h('tbody', {});
const empty = h('p', { class: 'dl-empty ui-muted', hidden: true });
const wrap = h('div', { class: 'dl-tablewrap ui-group' }, h('table', { class: 'dl-table' }, h('thead', {}, headRow), tbody), empty);

document.getElementById('app')!.append(
  h('header', { class: 'dl-head' }, h('h1', { class: 'ui-title' }, T.listTitle), total$),
  banner,
  status,
  h('div', { class: 'dl-layout' }, nav, h('section', { class: 'dl-main' }, toolbar, wrap)),
);

const parseFilter = (f: string): SidebarFilter =>
  f === 'unfinished' || f === 'finished' ? { kind: f } : f.startsWith('cat:') ? { kind: 'category', id: f.slice(4) as (typeof CATEGORY_IDS)[number] } : f.startsWith('queue:') ? { kind: 'queue', id: f.slice(6) } : { kind: 'all' };
const all = () => [...records.values()];
const navButtons = new Map<string, { button: HTMLElement; count: HTMLElement }>();
let navSignature = '';

function renderNav() {
  const signature = settings.queues.map((q) => `${q.id}\n${q.name}`).join('\n');
  if (signature !== navSignature) {
    navSignature = signature;
    navButtons.clear();
    const item = (f: string, label: string) => {
      const count = h('span', { class: 'dl-count ui-meta' });
      const button = h('button', { class: 'ui-btn ui-btn--ghost dl-nav-item', 'data-filter': f, onclick: () => ((filter = f), refresh(true)) }, h('span', { class: 'dl-label' }, label), count);
      navButtons.set(f, { button, count });
      return button;
    };
    const group = (label: string, ...items: HTMLElement[]) => h('div', { role: 'group', 'aria-label': label, class: 'dl-group' }, h('p', { class: 'ui-caption' }, label), ...items);
    nav.replaceChildren(
      item('all', T.navAll), item('unfinished', T.navUnfinished), item('finished', T.navFinished),
      group(T.navCategories, ...CATEGORY_IDS.map((id) => item(`cat:${id}`, T.categoryNames[id]))),
      group(T.navQueues, ...settings.queues.map((q) => item(`queue:${q.id}`, q.name))),
    );
  }
  if (!navButtons.has(filter)) filter = 'all';
  for (const [f, { button, count }] of navButtons) {
    count.textContent = String(filterRecords(all(), parseFilter(f)).length);
    if (f === filter) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }
}

interface Row { tr: HTMLTableRowElement; check: HTMLInputElement; name: HTMLElement; status: HTMLElement; actions: HTMLElement; size: HTMLElement; bar: HTMLProgressElement; pct: HTMLElement; speed: HTMLElement; eta: HTMLElement }
const rows = new Map<string, Row>();
const nextOpenAt = (q: QueueSetting, at: Date) => (isOpen(q.schedule, at) ? null : nextChange(q.schedule, at));
const setText = (el: Node, text: string) => el.textContent !== text && (el.textContent = text);

function makeRow(id: string): Row {
  const check = h('input', { type: 'checkbox', class: 'dl-select' });
  const name = h('div', { class: 'dl-name' });
  const st = h('div', { class: 'dl-status ui-meta' });
  const actions = h('div', { class: 'dl-row-actions' });
  const bar = h('progress', { max: 100 });
  const pct = h('span', { class: 'ui-meta ui-mono' });
  const size = h('span', { class: 'ui-mono' });
  const speed = h('span', { class: 'ui-mono' });
  const eta = h('span', { class: 'ui-mono' });
  const cell = (cls: string, ...kids: Node[]) => h('td', { class: cls }, ...kids);
  const tr = h('tr', { 'data-id': id }, cell('dl-check', check), cell('dl-cell-name', name, st, actions), cell('dl-num', size), cell('dl-cell-progress', bar, pct), cell('dl-num', speed), cell('dl-num', eta));
  return { tr, check, name, status: st, actions, size, bar, pct, speed, eta };
}

function updateRow(row: Row, r: DlRecord, now: Date) {
  const { percent } = progressOf(r);
  row.tr.setAttribute('aria-selected', String(selected.has(r.id)));
  row.check.checked = selected.has(r.id);
  row.check.setAttribute('aria-label', T.selectRow(r.name));
  setText(row.name, r.name);
  setText(row.status, statusText(r, settings.queues, settings.categories, now, nextOpenAt));
  if (!r.rangeOk && r.size !== null) row.status.title = T.st.noResume;
  else row.status.removeAttribute('title');
  setText(row.size, r.size === null ? '' : formatBytes(r.size));
  row.bar.setAttribute('aria-label', T.progressLabel(r.name));
  // Only a running download of unknown size shows the moving bar (as in the popup).
  if (percent === null && r.state === 'running') row.bar.removeAttribute('value');
  else row.bar.value = percent ?? 0;
  setText(row.pct, percent === null ? '' : `${percent}%`);
  setText(row.speed, formatSpeed(speeds[r.id] ?? 0));
  setText(row.eta, formatEta(etaSeconds(r, speeds[r.id] ?? 0)));
  const want = r.state === 'failed' ? 'retry' : r.state === 'done' && r.savedId !== null ? 'show' : '';
  if (row.actions.dataset.want !== want) {
    row.actions.dataset.want = want;
    row.actions.replaceChildren(
      ...(want === 'retry' ? [h('button', { class: 'ui-btn dl-retry', onclick: () => void retry(r.id) }, T.retryInChrome)] : []),
      ...(want === 'show' ? [h('button', { class: 'ui-btn dl-show', onclick: () => showInFolder(r.id) }, T.showInFolder)] : []),
    );
  }
}

async function retry(id: string) {
  const reply = await send({ type: 'dl-retry-chrome', id });
  say(reply?.ok ? '' : (reply?.message ?? T.actionFailed));
}

function showInFolder(id: string) {
  const savedId = records.get(id)?.savedId;
  try {
    if (savedId != null) chrome.downloads.show(savedId);
  } catch {
    say(T.actionFailed);
  }
}

function refresh(user = false) {
  const now = Date.now();
  renderNav();
  banner.hidden = settings.on;
  tools.speed.setAttribute('aria-pressed', String(settings.speedLimit.on));
  total$.hidden = !(total > 0);
  total$.textContent = formatSpeed(total);

  const visible = filterRecords(all(), parseFilter(filter));
  const visibleIds = new Set(visible.map((r) => r.id));
  for (const id of [...selected]) if (!visibleIds.has(id)) selected.delete(id);

  // Row order changes on a user action and otherwise at most every 2 s, so a speed sort does not jitter.
  if (user || now - reorderedAt >= 2000) {
    clearTimeout(reorderTimer);
    reorderTimer = undefined;
    reorderedAt = now;
    order = sortRecords(visible, sort.key, sort.dir, speeds).map((r) => r.id);
  } else {
    const known = new Set(order);
    order = [...order.filter((id) => visibleIds.has(id)), ...visible.filter((r) => !known.has(r.id)).map((r) => r.id)];
    reorderTimer ??= setTimeout(() => ((reorderTimer = undefined), refresh()), 2000 - (now - reorderedAt));
  }

  for (const [id, row] of rows) if (!visibleIds.has(id)) (row.tr.remove(), rows.delete(id));
  const at = new Date(now);
  for (const id of order) {
    let row = rows.get(id);
    if (!row) rows.set(id, (row = makeRow(id)));
    updateRow(row, records.get(id)!, at);
  }
  const shown = [...tbody.children].map((tr) => (tr as HTMLElement).dataset.id);
  if (shown.length !== order.length || shown.some((id, i) => id !== order[i])) {
    const focused = document.activeElement;
    tbody.replaceChildren(...order.map((id) => rows.get(id)!.tr));
    if (focused instanceof HTMLElement && focused !== document.activeElement && tbody.contains(focused)) focused.focus({ preventScroll: true });
  }

  for (const [key, th] of headers) {
    if (key === sort.key) th.setAttribute('aria-sort', sort.dir === 'asc' ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  }
  empty.hidden = order.length > 0;
  empty.textContent = records.size === 0 ? T.emptyAll : T.emptyFiltered;

  const picked = pickRecords();
  const any = (states: DlState[]) => picked.some((r) => states.includes(r.state));
  tools.resume.disabled = !any(['paused', 'failed', 'queued']);
  tools.pause.disabled = !any(['queued', 'running']);
  tools.delete.disabled = picked.length === 0 || any(['saving']);
}

const pickRecords = () => [...selected].map((id) => records.get(id)).filter((r): r is DlRecord => !!r);
const pick = (states: DlState[]) => pickRecords().filter((r) => states.includes(r.state)).map((r) => r.id);

tbody.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('button')) return;
  const id = target.closest('tr')?.dataset.id;
  if (!id) return;
  const toggle = e.metaKey || e.ctrlKey || target.closest('input') !== null;
  if (e.shiftKey && anchor && order.includes(anchor)) {
    const [a, b] = [order.indexOf(anchor), order.indexOf(id)].sort((x, y) => x - y);
    if (!toggle) selected.clear();
    for (const rid of order.slice(a, b + 1)) selected.add(rid);
  } else if (toggle) {
    if (!selected.delete(id)) selected.add(id);
    anchor = id;
  } else {
    selected.clear();
    selected.add(id);
    anchor = id;
  }
  refresh(true);
});

function confirmDelete() {
  const picked = pickRecords();
  if (picked.length === 0 || picked.some((r) => r.state === 'saving')) return;
  const unfinished = picked.some((r) => r.state !== 'done');
  const ids = picked.map((r) => r.id);
  const text = unfinished ? T.confirmDeleteUnfinished(ids.length) : T.confirmDeleteFinished(ids.length);
  const ok = h('button', { class: 'ui-btn ui-btn--danger', onclick: () => (void command('remove', ids.filter((id) => records.get(id)?.state !== 'saving')), dialog.close()) }, unfinished ? T.confirmDelete : T.confirmRemove);
  const dialog = h('dialog', { class: 'ui-sheet dl-dialog', 'aria-label': T.delete }, h('p', {}, text), h('div', { class: 'dl-actions' }, h('button', { class: 'ui-btn', onclick: () => dialog.close() }, T.cancel), ok));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

// A broadcast that arrives while the first read is still running wins over the stored copy.
const gone = new Set<string>();
const live = new Set<string>();
chrome.runtime.onMessage.addListener((m) => {
  if (m?.type !== 'dl-state') return;
  for (const r of m.records as DlRecord[]) (records.set(r.id, r), live.add(r.id), gone.delete(r.id));
  for (const id of m.removed as string[]) (records.delete(id), selected.delete(id), live.delete(id), gone.add(id));
  speeds = m.speeds ?? {};
  total = m.total ?? 0;
  refresh();
});
onDownloadsChanged((s) => ((settings = s), refresh()));

for (const r of await readAllRecords()) if (!live.has(r.id) && !gone.has(r.id)) records.set(r.id, r);
refresh(true);

if (location.hash === '#add') {
  const stored = (await chrome.storage.session.get('dlPrefill')).dlPrefill as { urls?: string[]; referrer?: string } | undefined;
  await chrome.storage.session.remove('dlPrefill');
  history.replaceState(null, '', location.pathname);
  void openAddDialog(stored?.urls?.length ? { urls: stored.urls, referrer: stored.referrer ?? '' } : {}).then(() => refresh(true));
}
