import { DOWNLOADS_KEY, validateDownloadSettings, type DownloadSettings } from '@apps-hub/sieve-core/src/dl-settings.ts';
import { T } from '@apps-hub/sieve-core/src/dl-text.ts';
import { toggle } from '../controls.ts';
import { h } from '../dom.ts';
import { readDownloads, saveDownloads } from './settings-store.ts';

export function openLimitDialog(): void {
  if (document.getElementById('dl-limit-dialog')) return;
  const on = toggle(T.limitOn, false, (value) => saveDownloads((s) => ({ ...s, speedLimit: { ...s.speedLimit, on: value } })));
  const sw = on.querySelector('input')!;
  const value: HTMLInputElement = h('input', {
    id: 'dl-limit-value',
    type: 'number',
    class: 'ui-input',
    min: 10,
    max: 1_000_000,
    step: 10,
    onchange: async () => {
      const kb = value.valueAsNumber;
      if (Number.isFinite(kb)) await saveDownloads((s) => ({ ...s, speedLimit: { ...s.speedLimit, kbPerSecond: kb } }));
      show(await readDownloads(), true);
    },
  });
  const show = (s: DownloadSettings, force = false) => {
    sw.checked = s.speedLimit.on;
    if (force || value !== document.activeElement) value.value = String(s.speedLimit.kbPerSecond);
  };
  const dialog = h(
    'dialog',
    { id: 'dl-limit-dialog', class: 'ui-sheet dl-dialog', 'aria-labelledby': 'dl-limit-title' },
    h('div', { class: 'dl-form' }, h('h2', { class: 'ui-heading', id: 'dl-limit-title' }, T.speedLimit), on, h('label', { class: 'ui-field' }, h('span', { class: 'ui-caption' }, T.limitValue), value), h('p', { class: 'dl-note' }, T.limitNote), h('div', { class: 'dl-actions' }, h('button', { type: 'button', class: 'ui-btn', onclick: () => dialog.close() }, T.close))),
  );
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && DOWNLOADS_KEY in changes) show(validateDownloadSettings(changes[DOWNLOADS_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(onStorage);
  dialog.addEventListener('close', () => (chrome.storage.onChanged.removeListener(onStorage), dialog.remove()));
  document.body.append(dialog);
  void readDownloads().then((s) => show(s, true));
  dialog.showModal();
}
