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

const canAllowlist = (entry: AllowEntry) => validateSettings({ blocking: { allowlist: [entry] } }).blocking.allowlist.length > 0;

async function save(edit: (s: Settings) => Settings): Promise<void> {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: edit(validateSettings(settings)) });
}
const setBlocking = (patch: Partial<Settings['blocking']>) => save((s) => ({ ...s, blocking: { ...s.blocking, ...patch } }));
const setList = (feature: FeatureKey, on: boolean) => save((s) => ({ ...s, blocking: { ...s.blocking, lists: { ...s.blocking.lists, [feature]: on } } }));

const toggle = (id: string, text: string, on: boolean, change: (on: boolean) => unknown) =>
  h('label', { class: 'switch' }, h('span', {}, text), h('input', { type: 'checkbox', role: 'switch', checked: on, 'data-id': id, onchange: (e: Event) => change((e.target as HTMLInputElement).checked) }));
const button = (id: string, text: string, onclick: () => unknown, props: Record<string, unknown> = {}) => h('button', { class: 'ui-btn', type: 'button', 'data-id': id, onclick, ...props }, text);

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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
      h('p', { class: 'counts' }, `${count(counts.ads, 'ad', 'ads')} and ${count(counts.trackers, 'tracker', 'trackers')} blocked on this page`),
      h(
        'div',
        { class: 'actions' },
        // The element picker arrives with Task 1.8.
        button('pick', 'Block an item on this page', () => {}, { disabled: true }),
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
    // There is no settings page until Task 1.9, so until then this opens nothing.
    h('footer', {}, button('settings', 'Settings', () => chrome.runtime.openOptionsPage().catch(() => {}), { class: 'ui-btn ui-btn--ghost' })),
  ];
}

let latest = 0;
async function render(): Promise<void> {
  const mine = ++latest;
  const [local, session] = await Promise.all([chrome.storage.local.get('settings'), chrome.storage.session.get(['blockingError', ...(tabCounts ? [tabCounts] : [])])]);
  if (mine !== latest) return;
  const message = (session.blockingError as { message?: unknown } | undefined)?.message;
  const state: State = {
    settings: validateSettings(local.settings),
    error: typeof message === 'string' ? message : undefined,
    counts: { ads: 0, trackers: 0, ...(tabCounts ? (session[tabCounts] as Partial<Counts> | undefined) : undefined) },
  };
  const focused = document.activeElement?.getAttribute('data-id');
  root.replaceChildren(...view(state).filter((c): c is Node => !!c));
  if (focused) root.querySelector<HTMLElement>(`[data-id="${focused}"]`)?.focus();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' ? 'settings' in changes : 'blockingError' in changes || (tabCounts !== undefined && tabCounts in changes)) void render();
});
await render();
