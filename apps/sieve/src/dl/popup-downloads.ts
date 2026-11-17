import type { DlRecord } from '@apps-hub/sieve-core/src/dl-record.ts';
import { T } from '@apps-hub/sieve-core/src/dl-text.ts';
import { formatSpeed, parseAddInput, progressOf } from '@apps-hub/sieve-core/src/dl-view.ts';
import { toggle } from '../controls.ts';
import { h, type Child } from '../dom.ts';
import { readAllRecords } from './idb-store.ts';
import { onDownloadsChanged, readDownloads, saveDownloads } from './settings-store.ts';

const MAX_ROWS = 5;
const ACTIVE = new Set(['running', 'saving', 'queued', 'paused']);

const records = new Map<string, DlRecord>();
const gone = new Set<string>();
let speeds: Record<string, number> = {};
let started = false;
let named = 0; // ids for the row names the buttons point at

const note = h('p', { class: 'ui-meta dl-note', role: 'status' });
const say = (text: string) => {
  note.textContent = text;
};

const switchEl = toggle(T.menuOn, true, (on) => saveDownloads((s) => ({ ...s, on })), { 'data-id': 'downloads-on' });
const switchInput = switchEl.querySelector('input')!;
const offLine = h('p', { class: 'ui-meta dl-off', hidden: true }, T.menuOff);
const none = h('p', { class: 'ui-meta dl-none' }, T.menuNone);
const list = h('div', { class: 'dl-list' });
const rows = new Map<string, { el: HTMLElement; name: HTMLElement; bar: HTMLProgressElement; speed: HTMLElement; btn: HTMLButtonElement }>();

async function command(op: 'pause' | 'resume', id: string): Promise<void> {
  try {
    const reply = await chrome.runtime.sendMessage({ type: 'dl-do', op, ids: [id] });
    if (reply?.ok === false) say(reply.message ?? T.actionFailed);
  } catch {
    say(T.actionFailed);
  }
}

function rowFor(id: string) {
  let row = rows.get(id);
  if (!row) {
    const name = h('span', { class: 'dl-name', id: `dl-row-name-${++named}` });
    const btn = h('button', { class: 'ui-btn ui-btn--ghost dl-act', type: 'button', 'aria-describedby': name.id }); // five Pause buttons, each tied to its file
    const bar = h('progress', { class: 'dl-bar', max: 100 });
    const speed = h('span', { class: 'ui-meta dl-speed' });
    btn.addEventListener('click', () => void command(btn.dataset.op as 'pause' | 'resume', id));
    row = { el: h('div', { class: 'dl-row', 'data-id': id }, h('div', { class: 'dl-top' }, name, btn), h('div', { class: 'dl-meter' }, bar, speed)), name, bar, speed, btn };
    rows.set(id, row);
  }
  return row;
}

function update(): void {
  const active = [...records.values()]
    .filter((r) => ACTIVE.has(r.state))
    .sort((a, b) => Number(b.state === 'running') - Number(a.state === 'running') || a.addedAt - b.addedAt)
    .slice(0, MAX_ROWS);
  const want = active.map((r) => {
    const row = rowFor(r.id);
    row.name.textContent = r.name;
    row.name.title = r.name;
    const { percent } = progressOf(r);
    // Only a running download of unknown size shows the moving bar.
    if (percent === null && r.state === 'running') row.bar.removeAttribute('value');
    else row.bar.value = percent ?? 0;
    row.bar.setAttribute('aria-label', T.progressLabel(r.name));
    row.speed.textContent = r.state === 'running' ? formatSpeed(speeds[r.id] ?? 0) : '';
    const op = r.state === 'paused' ? 'resume' : r.state === 'saving' ? null : 'pause';
    row.btn.hidden = op === null;
    if (op !== null && row.btn.dataset.op !== op) {
      row.btn.dataset.op = op;
      row.btn.textContent = op === 'resume' ? T.resume : T.pause;
    }
    return row.el;
  });
  for (const id of [...rows.keys()]) if (!active.some((r) => r.id === id)) rows.delete(id);
  // Only a changed order touches the DOM, so a click that began on a button survives the 4-per-second updates.
  if (want.length !== list.children.length || want.some((el, i) => list.children[i] !== el)) list.replaceChildren(...want);
  none.hidden = want.length > 0;
}

const showSettings = (on: boolean) => {
  switchInput.checked = on;
  offLine.hidden = on;
  list.classList.toggle('dl-dim', !on);
  none.classList.toggle('dl-dim', !on);
};

async function openList(): Promise<void> {
  const url = new URL(chrome.runtime.getURL('downloads.html'));
  // Chrome hides the url of an extension page from tabs.query without the "tabs" permission; the extension's own contexts say it.
  // The right-click menu navigates an open list tab to downloads.html?r=<n>#add, so match the prefix.
  const open = (await chrome.runtime.getContexts({ contextTypes: ['TAB'] })).find((c) => c.documentUrl?.startsWith(url.href) && c.tabId >= 0);
  if (open) {
    await chrome.tabs.update(open.tabId, { active: true });
    await chrome.windows.update(open.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: url.href });
  }
  window.close();
}

const box = h('textarea', { class: 'ui-input dl-box', rows: 3 });
const submit = h('button', { class: 'ui-btn ui-btn--primary', type: 'button' }, T.addSubmit);
const form = h('div', { class: 'dl-form', hidden: true }, h('label', { class: 'ui-field' }, h('span', { class: 'ui-meta' }, T.addLabel), box), submit);

submit.addEventListener('click', async () => {
  // The router takes at most 500 items in one message.
  const { urls, skipped, truncated } = parseAddInput(box.value, 500);
  if (urls.length === 0) return say(T.addNone);
  if (truncated) return say(T.addTooMany);
  submit.disabled = true;
  try {
    const reply = await chrome.runtime.sendMessage({ type: 'dl-add', items: urls.map((url) => ({ url, source: 'manual' })) });
    if (reply?.ok) {
      box.value = '';
      say(skipped > 0 ? T.addSkipped(skipped) : '');
    } else say(reply?.message ?? T.addFailed);
  } catch {
    say(T.addFailed);
  } finally {
    submit.disabled = false;
  }
});

const addBtn = h('button', { class: 'ui-btn', type: 'button', 'data-id': 'add', onclick: () => ((form.hidden = !form.hidden), form.hidden || box.focus()) }, T.menuAdd);
const seeAll = h('button', { class: 'ui-btn', type: 'button', 'data-id': 'see-all', onclick: () => void openList().catch(() => say(T.actionFailed)) }, T.menuSeeAll);

const panel = h(
  'section',
  { class: 'dl-panel', 'data-id': 'downloads-panel' },
  h('div', { class: 'ui-group dl-switch' }, switchEl),
  offLine,
  none,
  list,
  h('div', { class: 'dl-actions' }, addBtn, seeAll),
  form,
  note,
);

function start(): void {
  started = true;
  chrome.runtime.onMessage.addListener((m: unknown) => {
    const s = m as { type?: string; records?: DlRecord[]; removed?: string[]; speeds?: Record<string, number> } | null;
    if (s?.type !== 'dl-state') return false;
    for (const r of s.records ?? []) records.set(r.id, r);
    for (const id of s.removed ?? []) (records.delete(id), gone.add(id));
    speeds = s.speeds ?? speeds;
    update();
    return false;
  });
  onDownloadsChanged((s) => showSettings(s.on));
  void readDownloads().then((s) => showSettings(s.on), () => {});
  // A broadcast that arrived first is newer than the stored copy.
  void readAllRecords().then((all) => {
    for (const r of all) if (!records.has(r.id) && !gone.has(r.id)) records.set(r.id, r);
    update();
  });
}

export const downloadsTab: { id: 'downloads'; label: string; view: (state: unknown) => Child[] } = {
  id: 'downloads',
  label: T.sectionTitle,
  view: () => {
    if (!started) start();
    return [panel];
  },
};
