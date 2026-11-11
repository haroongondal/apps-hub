import { allowEntry } from '@apps-hub/sieve-core/src/allowlist.ts';
import { withNewLines } from '@apps-hub/sieve-core/src/my-filters.ts';
import type { BuildMeta } from '@apps-hub/sieve-core/src/plan.ts';
import { FEATURES, validateSettings, type AllowEntry, type FeatureKey, type Settings } from '@apps-hub/sieve-core/src/settings.ts';
import { NAMES, count, save, setBlocking, setList, toggle } from './controls.ts';
import { h, type Child } from './dom.ts';
import { FILTERS_CHANGED, TOO_MANY_TO_STORE, saveMyFilters, type SaveResult } from './my-filters.ts';
import { backupSection } from './options-backup.ts';
import { shortcutsSection } from './options-shortcuts.ts';
import { youtubeSection } from './options-youtube.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHOWN_ERRORS = 50;
const CHANGED_HERE = 'Your filters changed while this page was open.';

const read = async () => validateSettings((await chrome.storage.local.get('settings')).settings);
const [meta, initial] = await Promise.all([fetch('meta.json').then((r) => r.json() as Promise<BuildMeta>), read()]);
let settings = initial;

// Switches follow changes made elsewhere (the menu), so each keeps how to read its value.
const switches: { input: HTMLInputElement; read: (s: Settings) => boolean }[] = [];
function liveToggle(label: string, read: (s: Settings) => boolean, change: (on: boolean) => Promise<boolean>): HTMLElement {
  const row = toggle(label, read(settings), change);
  switches.push({ input: row.querySelector('input')!, read });
  return row;
}
const listToggle = (f: FeatureKey, label = NAMES[f]) => liveToggle(label, (s) => s.blocking.lists[f], (on) => setList(f, on));
const section = (id: string, title: string, ...kids: Child[]) => h('section', { id }, h('h2', { class: 'ui-heading' }, title), ...kids);

const listsAt = new Date(meta.listsAt);
const blocking = section(
  'blocking',
  'Blocking',
  h(
    'div',
    { class: 'ui-group rows' },
    listToggle('distraction'),
    listToggle('cookies'),
    listToggle('ai'),
    liveToggle('Site notification requests', (s) => s.blocking.denyNotifications, (on) => setBlocking({ denyNotifications: on })),
    listToggle('antiadblock'),
    listToggle('trackers'),
  ),
);
const lists = section(
  'lists',
  'Filter lists',
  h('div', { class: 'ui-group rows' }, ...FEATURES.map((f) => listToggle(f, meta.features[f].ruleCount ? `${NAMES[f]} · ${count(meta.features[f].ruleCount, 'rule', 'rules')}` : NAMES[f]))),
  h(
    'p',
    { class: 'ui-meta' },
    `Lists from ${listsAt.getDate()} ${MONTHS[listsAt.getMonth()]} ${listsAt.getFullYear()}. To update them, run pnpm --filter sieve build -- --refresh, then reload Sieve.`,
  ),
);

let edited = false;
const area = h('textarea', { class: 'filters', spellcheck: false, rows: 12, 'aria-label': 'My filters', oninput: () => (edited = true) });
area.value = settings.blocking.myFilters;
let loaded = area.value;
const notice = h('p', { class: 'ui-meta notice', role: 'status' });
const result = h('div', { class: 'result', 'aria-live': 'polite' });
const saveButton = h('button', { class: 'ui-btn ui-btn--primary', type: 'button', onclick: () => void saveFilters() }, 'Save');

function showResult({ saved, errors, notSaved }: SaveResult): void {
  const listed = errors.filter((e) => !(e.line === 0 && e.reason === notSaved));
  const parts: Child[] = [
    notSaved === undefined
      ? h('p', {}, `Saved ${count(saved, 'filter', 'filters')}.`)
      : h(
          'p',
          { class: 'error' },
          notSaved === FILTERS_CHANGED || notSaved === TOO_MANY_TO_STORE
            ? notSaved
            : `Chrome refused these filters, so the ones saved before stay on. Remove some filters or fix the one Chrome names, then save again. Chrome says: ${notSaved}`,
        ),
    listed.length > 0 && h('ul', { class: 'errors' }, ...listed.slice(0, SHOWN_ERRORS).map((e) => h('li', {}, e.line ? `Line ${e.line}: ${e.reason}` : e.reason))),
    listed.length > SHOWN_ERRORS && h('p', { class: 'ui-meta' }, `and ${(listed.length - SHOWN_ERRORS).toLocaleString('en-US')} more`),
  ];
  result.replaceChildren(...parts.filter((p): p is Node => !!p));
}

// The text area follows the stored filters until the owner edits it; after that a change from elsewhere (a pick) is only announced.
// While a save runs it waits, and catches up once the save is done.
let pending = false;
function follow(text: string): void {
  if (pending || text === loaded) return;
  if (!edited || text === area.value) {
    area.value = loaded = text;
    edited = false;
    notice.textContent = '';
  } else {
    notice.textContent = `${CHANGED_HERE} Saving keeps your text and adds the new lines after it.`;
  }
}

async function saveFilters(): Promise<void> {
  const text = area.value; // what Save saves; anything typed while it runs stays in the box as an edit
  pending = true;
  saveButton.disabled = true;
  result.replaceChildren(h('p', { class: 'ui-meta' }, 'Saving…'));
  try {
    const stored = (await read()).blocking.myFilters;
    const merged = withNewLines(text, loaded, stored);
    if (merged.added) area.value = withNewLines(area.value, loaded, stored).text;
    loaded = stored;
    const outcome = await saveMyFilters(merged.text, stored);
    if (outcome.notSaved === undefined) {
      loaded = merged.text;
      edited = area.value !== merged.text;
    }
    notice.textContent = merged.added ? `${CHANGED_HERE} Sieve added the new lines at the end of yours.` : '';
    showResult(outcome);
  } catch (e) {
    console.error('Sieve could not save My filters', e);
    result.replaceChildren(h('p', { class: 'error' }, "Sieve couldn't save your filters. Reload this page, then try again."));
  } finally {
    pending = false;
    saveButton.disabled = false;
  }
  follow((await read()).blocking.myFilters);
}

const mine = section(
  'my-filters',
  'My filters',
  h('p', { class: 'ui-meta' }, 'One filter per line, in Adblock Plus or AdGuard syntax.'),
  area,
  notice,
  h('div', { class: 'row' }, saveButton),
  result,
);

const same = (a: AllowEntry, b: AllowEntry) => JSON.stringify(a) === JSON.stringify(b);
const entries = h('ul', { class: 'entries ui-group' });
function renderAllowlist(): void {
  const list = settings.blocking.allowlist;
  entries.hidden = list.length === 0;
  entries.replaceChildren(
    ...list.map((e) => {
      const label = e.kind === 'site' ? e.host : e.url;
      const remove = () => save((s) => ({ ...s, blocking: { ...s.blocking, allowlist: s.blocking.allowlist.filter((x) => !same(x, e)) } }));
      return h('li', {}, h('span', { class: 'entry' }, label), h('button', { class: 'ui-btn', type: 'button', 'aria-label': `Remove ${label}`, onclick: remove }, 'Remove'));
    }),
  );
}
const address = h('input', { class: 'ui-input', type: 'text', 'aria-label': 'Site or page address', placeholder: 'example.com or a page address', onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && add() });
const addError = h('p', { class: 'error', role: 'alert' });
function add(): void {
  const entry = allowEntry(address.value);
  addError.textContent = entry ? '' : 'Enter a site like example.com or a full page address.';
  if (!entry) return;
  address.value = '';
  void save((s) => ({ ...s, blocking: { ...s.blocking, allowlist: s.blocking.allowlist.some((x) => same(x, entry)) ? s.blocking.allowlist : [...s.blocking.allowlist, entry] } }));
}
const allow = section(
  'allowlist',
  'Allowlist',
  h('p', { class: 'ui-meta' }, "Sieve doesn't block anything on these sites and pages."),
  entries,
  h('div', { class: 'row' }, address, h('button', { class: 'ui-btn', type: 'button', onclick: add }, 'Add')),
  addError,
);

chrome.storage.onChanged.addListener((changes, where) => {
  if (where !== 'local' || !('settings' in changes)) return;
  settings = validateSettings(changes.settings.newValue);
  for (const s of switches) s.input.checked = s.read(settings);
  renderAllowlist();
  follow(settings.blocking.myFilters);
});

renderAllowlist();
const sections = [blocking, lists, mine, allow, youtubeSection(), shortcutsSection(), backupSection()];
const nav = h('nav', { 'aria-label': 'Settings sections' }, ...sections.map((s) => h('a', { href: `#${s.id}` }, s.querySelector('h2')!.textContent)));
document.getElementById('app')!.replaceChildren(h('header', {}, h('h1', { class: 'ui-title' }, 'Sieve settings')), nav, h('div', { class: 'content' }, ...sections));
// The sections are drawn after the page loads, so the browser may have missed the address's #section.
document.getElementById(location.hash.slice(1))?.scrollIntoView();
