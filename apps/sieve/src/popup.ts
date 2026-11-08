import { isAllowed, tabSite } from '@apps-hub/sieve-core/src/allowlist.ts';
import { countsKey, type Counts } from '@apps-hub/sieve-core/src/counts.ts';
import { validateSettings, type AllowEntry, type Settings } from '@apps-hub/sieve-core/src/settings.ts';
import { youtubeAdsOn, ytChannel } from '@apps-hub/sieve-core/src/youtube-ads.ts';
import { NAMES, count, errorText, save, setBlocking, setList, toggle } from './controls.ts';
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
const tabUrl = site === null ? null : new URL(site.page);
// Only www.youtube.com: on m. and music. the anti-adblock list strips the same ads whatever the channel, so the switch would do nothing.
const ytReply = tab?.id !== undefined && tabUrl?.hostname === 'www.youtube.com' && tabUrl.pathname === '/watch' ? await chrome.tabs.sendMessage(tab.id, { type: 'yt-channel' }, { frameId: 0 }).catch(() => null) : null;
const ytFound = ytChannel(ytReply);
const channel = ytFound && { id: ytFound.id, name: ytFound.name };
let reloadHint = false;
let pickFailed: string | undefined;
let liveCounts: Counts | undefined;

const canAllowlist = (entry: AllowEntry) => validateSettings({ blocking: { allowlist: [entry] } }).blocking.allowlist.length > 0;

const button = (id: string, text: string, onclick: () => unknown, props: Record<string, unknown> = {}) => h('button', { class: 'ui-btn', type: 'button', 'data-id': id, onclick, ...props }, text);
const errorBanner = h('p', { class: 'banner banner--danger', role: 'alert' });
const SWAPS: Record<string, string> = { pause: 'resume', resume: 'pause' };

// The picker lives in the page, so the menu only starts it and gets out of the way.
async function pickItem(): Promise<void> {
  if (tab?.id === undefined) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['picker.js'] });
    window.close();
  } catch (e) {
    console.error('Sieve could not open the item picker', e);
    // Chrome never lets extensions script some pages (the Chrome Web Store); a reload can't help there.
    pickFailed = /cannot be scripted/i.test(e instanceof Error ? e.message : String(e))
      ? "Sieve can't open the item picker on this page."
      : "Sieve couldn't open the item picker here. Reload this page, then try again.";
    await render();
  }
}

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
    const allowChannel = (on: boolean) => {
      reloadHint = true;
      return save((x) => {
        const rest = x.blocking.youtubeAllowedChannels.filter((c) => c.id !== channel?.id);
        return { ...x, blocking: { ...x.blocking, youtubeAllowedChannels: on && channel ? [...rest, channel] : rest } };
      });
    };
    here = h(
      'section',
      { class: 'ui-group card' },
      h('p', { class: 'ui-heading host' }, host),
      canAllowlist({ kind: 'site', host })
        ? toggle('Block on this site', !isAllowed(page, entries.filter((e) => e.kind === 'site')), allowSite, { 'data-id': 'site' })
        : h('p', { class: 'ui-meta' }, "Sieve can't turn blocking off for this address."),
      channel !== null &&
        youtubeAdsOn(s, page) &&
        toggle(`Allow ads on ${channel.name}`, s.blocking.youtubeAllowedChannels.some((c) => c.id === channel.id), allowChannel, { 'data-id': 'yt-channel' }),
      h('p', { class: 'counts' }, countsText(counts)),
      h(
        'div',
        { class: 'actions' },
        // Where blocking is off a saved pick would not show after a reload, and an address Sieve can't write a filter for has no host to save it under.
        button('pick', 'Block an item on this page', pickItem, { disabled: !canAllowlist({ kind: 'site', host }) || s.blocking.paused || isAllowed(page, entries) }),
        pickFailed !== undefined && h('p', { class: 'ui-meta', role: 'alert' }, pickFailed),
        button('page', pageEntry ? 'Resume on this page' : 'Pause on this page', pausePage, { disabled: !canAllowlist({ kind: 'page', url: page }) }),
        reloadHint && h('p', { class: 'ui-meta' }, 'Reload this page to see the change.'),
      ),
    );
  }
  const switches = h(
    'section',
    { class: 'ui-group switches' },
    ...(['distraction', 'cookies', 'ai'] as const).map((f) => toggle(NAMES[f], s.blocking.lists[f], (on) => setList(f, on), { 'data-id': f })),
    toggle('Site notification requests', s.blocking.denyNotifications, (on) => setBlocking({ denyNotifications: on }), { 'data-id': 'notifications' }),
  );
  if (error !== undefined && errorBanner.textContent !== errorText(error)) errorBanner.textContent = errorText(error);
  return [
    error !== undefined && errorBanner,
    s.blocking.paused && h('div', { class: 'banner banner--warn', role: 'status' }, h('span', {}, 'Blocking is paused everywhere'), button('resume', 'Resume', () => setBlocking({ paused: false }))),
    h('div', { class: 'stack', inert: !s.enabled }, here, switches, !s.blocking.paused && button('pause', 'Pause everywhere', () => setBlocking({ paused: true }))),
  ];
}

const tabs = [{ id: 'blocking', label: 'Blocking', view: blockingView }];
let current = tabs[0].id;

function view(state: State): Child[] {
  return [
    h('header', { class: 'bar' }, h('h1', { class: 'ui-heading' }, 'Sieve'), toggle('Sieve on', state.settings.enabled, (on) => save((s) => ({ ...s, enabled: on })), { 'data-id': 'enabled' })),
    tabs.length > 1 &&
      h(
        'nav',
        { class: 'ui-toolbar', role: 'tablist' },
        ...tabs.map((t) =>
          h('button', { class: `ui-btn ui-btn--ghost${t.id === current ? ' is-active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(t.id === current), onclick: () => ((current = t.id), render()) }, t.label),
        ),
      ),
    ...tabs.find((t) => t.id === current)!.view(state),
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
  const nodes = view(state).filter((c): c is Node => !!c);
  // The error banner stays in the page while it shows, so a screen reader announces it once, not on every change.
  const at = nodes.indexOf(errorBanner);
  if (at >= 0 && errorBanner.parentNode === root) {
    for (const node of [...root.childNodes]) if (node !== errorBanner) node.remove();
    errorBanner.before(...nodes.slice(0, at));
    errorBanner.after(...nodes.slice(at + 1));
  } else root.replaceChildren(...nodes);
  // "Pause everywhere" and "Resume" replace each other, so focus moves to the one that took the place of the button pressed.
  if (focused) (root.querySelector<HTMLElement>(`[data-id="${focused}"]`) ?? root.querySelector<HTMLElement>(`[data-id="${SWAPS[focused]}"]`))?.focus();
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
