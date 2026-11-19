import { h } from './dom.ts';

export function shortcutsSection(): HTMLElement {
  const list = h('ul', { class: 'shortcuts ui-group' });
  const error = h('p', { class: 'error', role: 'alert' });
  async function show(): Promise<void> {
    try {
      // Chrome adds `_execute_action` for the toolbar button; it is not one of Sieve's shortcuts.
      const commands = (await chrome.commands.getAll()).filter((c) => !c.name?.startsWith('_'));
      list.replaceChildren(...commands.map((c) => h('li', {}, h('span', { class: 'entry' }, c.description || c.name || ''), h('span', { class: 'ui-meta' }, c.shortcut || 'Not set'))));
      error.textContent = '';
    } catch (e) {
      console.error('Sieve could not read its shortcuts', e);
      error.textContent = "Sieve couldn't read the shortcuts. Reload this page, then try again.";
    }
  }
  void show();
  // Keys are set on another page, so the list catches up when the owner comes back.
  window.addEventListener('focus', () => void show());
  return h(
    'section',
    { id: 'shortcuts' },
    h('h2', { class: 'ui-heading' }, 'Shortcuts'),
    h('p', { class: 'ui-meta' }, "Chrome lets you set keys for these actions. Sieve sets none, so they never clash with YouTube's keys or a site's."),
    list,
    error,
    h('div', { class: 'row' }, h('button', { class: 'ui-btn', type: 'button', onclick: () => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }) }, 'Set shortcuts in Chrome')),
  );
}
