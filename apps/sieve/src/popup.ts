import { isAllowed, tabSite } from '@apps-hub/sieve-core/src/allowlist.ts';
import { countsKey, type Counts } from '@apps-hub/sieve-core/src/counts.ts';
import { validateSettings, type AllowEntry, type FeatureKey, type Settings } from '@apps-hub/sieve-core/src/settings.ts';
import { h, type Child } from './dom.ts';

interface State {
  settings: Settings;
  error: string | undefined;
  counts: Counts;
}

const root = document.getElementById('app')!;

async function targetTab(): Promise<chrome.tabs.Tab | undefined> {
  const requested = new URLSearchParams(location.search).get('tab');
  try {
    return requested ? await chrome.tabs.get(Number(requested)) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  } catch {
    return undefined;
  }
}

const tab = await targetTab();
const site = tabSite(tab?.url);
const tabCounts = tab?.id === undefined ? undefined : countsKey(tab.id);
let reloadHint = false;
let pickFailed = false;
let liveCounts: Counts | undefined;

const canAllowlist = (entry: AllowEntry) => validateSettings({ blocking: { allowlist: [entry] } }).blocking.allowlist.length > 0;

// One at a time: two quick changes would otherwise both read the old settings, and the second write would undo the first.
let saving: Promise<unknown> = Promise.resolve();
function save(edit: (s: Settings) => Settings): Promise<void> {
  const run = saving.then(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: edit(validateSettings(settings)) });
  });
  saving = run.catch(() => {});
  return run;
}
const setBlocking = (patch: Partial<Settings['blocking']>) => save((s) => ({ ...s, blocking: { ...s.blocking, ...patch } }));
const setList = (feature: FeatureKey, on: boolean) => save((s) => ({ ...s, blocking: { ...s.blocking, lists: { ...s.blocking.lists, [feature]: on } } }));

const toggle = (id: string, text: string, on: boolean, change: (on: boolean) => unknown) =>
  h('label', { class: 'switch' }, h('span', {}, text), h('input', { type: 'checkbox', role: 'switch', checked: on, 'data-id': id, onchange: (e: Event) => change((e.target as HTMLInputElement).checked) }));
const button = (id: string, text: string, onclick: () => unknown, props: Record<string, unknown> = {}) => h('button', { class: 'ui-btn', type: 'button', 'data-id': id, onclick, ...props }, text);

// The picker lives in the page, so the menu only starts it and gets out of the way.
async function pickItem(): Promise<void> {
  if (tab?.id === undefined) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['picker.js'] });
    window.close();
  } catch (e) {
    console.error('Sieve could not open the item picker', e);
    pickFailed = true;
    await render();
  }
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const countsText = (c: Counts) => `${count(c.ads, 'ad', 'ads')} and ${count(c.trackers, 'tracker', 'trackers')} blocked on this page`;

function blockingView({ settings: s, error, counts }: State): Child[] {
  const entries = s.blocking.allowlist;
  let here: HTMLElement;
  if (site === null) {
    here = h('section', { class: 'ui-group card' }, h('p', {}, "Sieve doesn't run on this page."));
  } else {
    const { host, page } = site;
    const pageEntry = entries.some((e) => e.kind === 'page' && e.url === page);
    const allowSite = (on: boolean) => {
      reloadHint = true;
      return save((x) => {
        const rest = x.blocking.allowlist.filter((e) => !(e.kind === 'site' && isAllowed(page, [e])));
        return { ...x, blocking: { ...x.blocking, allowlist: on ? rest : [...rest, { kind: 'site', host }] } };
      });
    };
    const pausePage = () => {
      reloadHint = true;
      return save((x) => {
        const rest = x.blocking.allowlist.filter((e) => !(e.kind === 'page' && e.url === page));
        return { ...x, blocking: { ...x.blocking, allowlist: pageEntry ? rest : [...rest, { kind: 'page', url: page }] } };
      });
    };
    here = h(
      'section',
      { class: 'ui-group card' },
      h('p', { class: 'ui-heading host' }, host),
      canAllowlist({ kind: 'site', host })
        ? toggle('site', 'Block on this site', !isAllowed(page, entries.filter((e) => e.kind === 'site')), allowSite)
        : h('p', { class: 'ui-meta' }, "Sieve can't turn blocking off for this address."),
      h('p', { class: 'counts' }, countsText(counts)),
      h(
        'div',
        { class: 'actions' },
        // Where blocking is off a saved pick would not show after a reload, and an address Sieve can't write a filter for has no host to save it under.
        button('pick', 'Block an item on this page', pickItem, { disabled: !canAllowlist({ kind: 'site', host }) || s.blocking.paused || isAllowed(page, entries) }),
        pickFailed && h('p', { class: 'ui-meta', role: 'alert' }, "Sieve couldn't open the item picker here. Reload this page, then try again."),
        button('page', pageEntry ? 'Resume on this page' : 'Pause on this page', pausePage, { disabled: !canAllowlist({ kind: 'page', url: page }) }),
        reloadHint && h('p', { class: 'ui-meta' }, 'Reload this page to see the change.'),
      ),
    );
  }
  const switches = h(
    'section',
    { class: 'ui-group switches' },
    toggle('distraction', 'Distraction control', s.blocking.lists.distraction, (on) => setList('distraction', on)),
    toggle('cookies', 'Cookie banners', s.blocking.lists.cookies, (on) => setList('cookies', on)),
    toggle('ai', 'AI search summaries', s.blocking.lists.ai, (on) => setList('ai', on)),
    toggle('notifications', 'Site notification requests', s.blocking.denyNotifications, (on) => setBlocking({ denyNotifications: on })),
  );
  return [
    error !== undefined && h('p', { class: 'banner banner--danger', role: 'alert' }, `${/[.!?]$/.test(error) ? error : `${error}.`} Turn a list off in Settings to make room.`),
    s.blocking.paused && h('div', { class: 'banner banner--warn', role: 'status' }, h('span', {}, 'Blocking is paused everywhere'), button('resume', 'Resume', () => setBlocking({ paused: false }))),
    h('div', { class: 'stack', inert: !s.enabled }, here, switches, !s.blocking.paused && button('pause', 'Pause everywhere', () => setBlocking({ paused: true }))),
  ];
}

const tabs = [{ id: 'blocking', label: 'Blocking', view: blockingView }];
let current = tabs[0].id;

function view(state: State): Child[] {
  return [
    h('header', { class: 'bar' }, h('h1', { class: 'ui-heading' }, 'Sieve'), toggle('enabled', 'Sieve on', state.settings.enabled, (on) => save((s) => ({ ...s, enabled: on })))),
    tabs.length > 1 &&
      h(
        'nav',
        { class: 'ui-toolbar', role: 'tablist' },
        ...tabs.map((t) =>
          h('button', { class: `ui-btn ui-btn--ghost${t.id === current ? ' is-active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(t.id === current), onclick: () => ((current = t.id), render()) }, t.label),
        ),
      ),
    ...tabs.find((t) => t.id === current)!.view(state),
    // There is no settings page until Task 1.9, so until then this logs an error.
    h('footer', {}, button('settings', 'Settings', () => chrome.runtime.openOptionsPage().catch((e) => console.error('Sieve could not open the settings page', e)), { class: 'ui-btn ui-btn--ghost' })),
  ];
}

let latest = 0;
async function render(): Promise<void> {
  const mine = ++latest;
  const [local, session] = await Promise.all([chrome.storage.local.get('settings'), chrome.storage.session.get(['blockingError', ...(tabCounts ? [tabCounts] : [])])]);
  if (mine !== latest) return;
  const message = (session.blockingError as { message?: unknown } | undefined)?.message;
  liveCounts ??= { ads: 0, trackers: 0, ...(tabCounts ? (session[tabCounts] as Partial<Counts> | undefined) : undefined) };
  const state: State = {
    settings: validateSettings(local.settings),
    error: typeof message === 'string' ? message : undefined,
    counts: liveCounts,
  };
  const focused = document.activeElement?.getAttribute('data-id');
  root.replaceChildren(...view(state).filter((c): c is Node => !!c));
  if (focused) root.querySelector<HTMLElement>(`[data-id="${focused}"]`)?.focus();
}

// A count change only edits the number: rebuilding the menu under the pointer would lose a click that began on the old switch.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' ? 'settings' in changes : 'blockingError' in changes) void render();
  else if (area === 'session' && tabCounts !== undefined && tabCounts in changes) {
    liveCounts = { ads: 0, trackers: 0, ...(changes[tabCounts].newValue as Partial<Counts> | undefined) };
    const shown = root.querySelector('.counts');
    if (shown) shown.textContent = countsText(liveCounts);
  }
});
await render();
