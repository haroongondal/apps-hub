import { formatSpeed } from '@apps-hub/sieve-core/src/playback.ts';
import { mergeYouTube, QUALITY_HEIGHT, validateYouTube, YOUTUBE_KEY, type Quality } from '@apps-hub/sieve-core/src/youtube-settings.ts';
import { ytPage } from '@apps-hub/sieve-core/src/yt-bridge.ts';
import { toggle } from './controls.ts';
import { h, type Child } from './dom.ts';
import { withSettingsLock } from './lock.ts';
import type { MenuSnapshot } from './yt/menu.ts';

const SWITCHES = [
  ['loop', 'Loop'],
  ['boost', 'Volume boost'],
  ['cinema', 'Cinema mode'],
  ['expand', 'Expand player'],
  ['filters', 'Video filters'],
  ['flip-h', 'Flip horizontally'],
  ['flip-v', 'Flip vertically'],
  ['reverse-playlist', 'Reverse playlist'],
] as const;

// Menu controls and the fresh state they show; the controls are edited in place so a snapshot never replaces a button under the pointer.
export async function createYoutubeView(tab: chrome.tabs.Tab | undefined): Promise<() => Child[]> {
  let stored = validateYouTube((await chrome.storage.local.get(YOUTUBE_KEY))[YOUTUBE_KEY]);
  let snap: MenuSnapshot | null = null;
  let port: chrome.runtime.Port | undefined;
  let picked: { videoId: string | null; quality: string } | null = null;
  const send = (action: string): void => port?.postMessage({ type: 'do', action });

  const setOn = (on: boolean): Promise<boolean> =>
    withSettingsLock(async () => {
      const { [YOUTUBE_KEY]: current } = await chrome.storage.local.get(YOUTUBE_KEY);
      await chrome.storage.local.set({ [YOUTUBE_KEY]: mergeYouTube(validateYouTube(current), { on }) });
    }).then(
      () => true,
      (e) => {
        console.error('Sieve could not save the YouTube tools switch', e);
        return false;
      },
    );

  const tools = toggle('YouTube tools', stored.on, setOn, { 'data-id': 'yt-on' });
  const toolsInput = tools.querySelector('input')!;
  const press = (id: string, label: string, text: string) => h('button', { class: 'ui-btn', type: 'button', 'data-id': id, 'aria-label': label, onclick: () => send(id) }, text);
  const speed = h('output', { class: 'ui-mono speed-value', 'data-id': 'speed-value' }, formatSpeed(1));
  const quality = h('select', { class: 'ui-select', id: 'yt-quality', onchange: () => {
    picked = { videoId: snap?.state?.videoId ?? null, quality: quality.value };
    send(`quality-${quality.value}`);
  } });
  const rows = new Map(SWITCHES.map(([action, label]) => {
    const row = toggle(label, false, async () => (send(action), true), { 'data-id': action });
    return [action, { row, input: row.querySelector('input')! }] as const;
  }));
  const controls = h(
    'div',
    { class: 'stack', 'data-id': 'yt-controls' },
    h('div', { class: 'speed-row' }, h('span', {}, 'Speed'), h('div', { class: 'ui-toolbar' }, press('speed-down', 'Slower', '−'), speed, press('speed-up', 'Faster', '+'))),
    h('div', { class: 'ui-field' }, h('label', { class: 'ui-meta', for: 'yt-quality' }, 'Quality'), quality),
    h('section', { class: 'ui-group switches' }, ...[...rows.values()].map((r) => r.row)),
    h('div', { class: 'actions' }, h('button', { class: 'ui-btn', type: 'button', 'data-id': 'screenshot', onclick: () => send('screenshot') }, 'Take a screenshot'), h('button', { class: 'ui-btn', type: 'button', 'data-id': 'stop', onclick: () => send('stop') }, 'Stop')),
  );
  const empty = h('p', { class: 'ui-meta', 'data-id': 'yt-empty' }, 'Open a YouTube video to use these tools.');
  const link = h('a', { class: 'ui-btn ui-btn--ghost', href: 'options.html#youtube', target: '_blank', 'data-id': 'yt-settings' }, 'YouTube settings');
  const nodes: Child[] = [h('section', { class: 'ui-group switches' }, tools), controls, empty, link];

  function sync(): void {
    const kind = snap?.page.kind;
    const ready = kind === 'watch' || kind === 'embed';
    toolsInput.checked = stored.on;
    controls.hidden = !ready;
    empty.hidden = ready;
    controls.toggleAttribute('inert', !stored.on);
    if (!snap || !ready) return;
    const { state, pressed } = snap;
    speed.textContent = formatSpeed(state?.rate ?? 1);
    for (const [action, { row, input }] of rows) {
      input.checked = action === 'reverse-playlist' ? state?.playlist?.reversed === true : pressed[action] === true;
      row.hidden = action === 'reverse-playlist' && state?.playlist == null;
    }
    const levels: string[] = ['auto', ...(state?.qualities ?? [])];
    if (quality.options.length !== levels.length || levels.some((q, i) => quality.options[i].value !== q)) {
      quality.replaceChildren(...levels.map((q) => h('option', { value: q }, q === 'auto' ? 'Auto' : `${QUALITY_HEIGHT[q as Quality]}p`)));
    }
    if (picked && picked.videoId !== (state?.videoId ?? null)) picked = null;
    quality.value = picked?.quality ?? (state && levels.includes(state.quality) ? state.quality : 'auto');
  }

  if (tab?.id !== undefined && ytPage(tab.url ?? '').kind !== 'other') {
    const p = chrome.tabs.connect(tab.id, { name: 'yt-menu', frameId: 0 });
    port = p;
    p.onMessage.addListener((m: MenuSnapshot) => {
      if (m?.type !== 'state') return;
      snap = m;
      sync();
    });
    // A tab with no receiver (no content script yet) disconnects at once: the tab then shows the empty state.
    p.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      snap = null;
      port = undefined;
      sync();
    });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(YOUTUBE_KEY in changes)) return;
    stored = validateYouTube(changes[YOUTUBE_KEY].newValue);
    sync();
  });
  sync();
  return () => nodes;
}
