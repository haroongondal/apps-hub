import { BACKUP_MAX_CHARS, BACKUP_TOO_BIG, backupFileName, makeBackup, readBackup } from '@apps-hub/sieve-core/src/backup.ts';
import { validateSettings, type Settings } from '@apps-hub/sieve-core/src/settings.ts';
import { YOUTUBE_KEY, validateYouTube, type YouTubeSettings } from '@apps-hub/sieve-core/src/youtube-settings.ts';
import { count } from './controls.ts';
import { h } from './dom.ts';
import { withSettingsLock } from './lock.ts';
import { saveMyFilters } from './my-filters.ts';

const readSettings = async () => validateSettings((await chrome.storage.local.get('settings')).settings);

export function backupSection(): HTMLElement {
  let chosen: { settings: Settings; youtube: YouTubeSettings } | null = null;
  const error = h('p', { class: 'error', role: 'alert' });
  const done = h('p', { role: 'status' });
  const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: () => void choose() });
  const replace = h('button', { class: 'ui-btn ui-btn--primary', type: 'button', onclick: () => void replaceSettings() }, 'Replace my settings');
  const cancel = h('button', { class: 'ui-btn', type: 'button', onclick: () => ask(null) }, 'Cancel');
  const warning = [h('p', {}, 'Importing replaces all your Sieve settings, filters and allowlist.'), h('div', { class: 'row' }, replace, cancel)];

  function ask(backup: typeof chosen): void {
    chosen = backup;
    for (const node of warning) backup ? done.before(node) : node.remove();
    file.value = '';
  }

  async function save(): Promise<void> {
    error.textContent = done.textContent = '';
    try {
      const [settings, youtube] = await Promise.all([readSettings(), chrome.storage.local.get(YOUTUBE_KEY).then((r) => validateYouTube(r[YOUTUBE_KEY]))]);
      const now = new Date();
      const url = URL.createObjectURL(new Blob([JSON.stringify(makeBackup(settings, youtube, now), null, 2)], { type: 'application/json' }));
      h('a', { href: url, download: backupFileName(now) }).click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      console.error('Sieve could not save a backup', e);
      error.textContent = "Sieve couldn't save the backup. Reload this page, then try again.";
    }
  }

  async function choose(): Promise<void> {
    const picked = file.files?.[0]; // before ask() clears the input
    error.textContent = done.textContent = '';
    ask(null);
    if (!picked) return;
    // A file over the limit is refused unread; core words the refusal.
    const read = picked.size > BACKUP_MAX_CHARS ? { ok: false as const, reason: BACKUP_TOO_BIG } : readBackup(await picked.text());
    if (!read.ok) {
      error.textContent = read.reason;
      file.value = '';
      return;
    }
    ask({ settings: read.settings, youtube: read.youtube });
  }

  async function replaceSettings(): Promise<void> {
    const backup = chosen;
    if (!backup) return;
    replace.disabled = cancel.disabled = true;
    try {
      const stored = (await readSettings()).blocking.myFilters;
      const filters = await saveMyFilters(backup.settings.blocking.myFilters, stored);
      if (filters.notSaved !== undefined) {
        error.textContent = `Sieve didn't import anything: ${filters.notSaved}`;
        return;
      }
      try {
        await withSettingsLock(async () => {
          const current = await readSettings();
          await chrome.storage.local.set({
            settings: { ...backup.settings, blocking: { ...backup.settings.blocking, myFilters: current.blocking.myFilters } },
            [YOUTUBE_KEY]: backup.youtube,
          });
        });
      } catch (e) {
        console.error('Sieve could not store the imported settings', e);
        error.textContent = 'Sieve imported your filters but not the rest. Import the backup again.';
        return;
      }
      const skipped = new Set(filters.errors.filter((e) => e.line > 0).map((e) => e.line)).size;
      done.textContent = `Imported your settings.${skipped ? ` ${count(skipped, 'line', 'lines')} in My filters had errors and ${skipped === 1 ? 'was' : 'were'} skipped.` : ''}`;
      ask(null);
    } catch (e) {
      console.error('Sieve could not import a backup', e);
      error.textContent = "Sieve didn't import anything. Reload this page, then try again.";
    } finally {
      replace.disabled = cancel.disabled = false;
    }
  }

  return h(
    'section',
    { id: 'backup' },
    h('h2', { class: 'ui-heading' }, 'Backup and import'),
    h('p', { class: 'ui-meta' }, 'Save every Sieve setting, your filters, allowlist and YouTube options in one file.'),
    h('div', { class: 'row' }, h('button', { class: 'ui-btn', type: 'button', onclick: () => void save() }, 'Save a backup'), h('button', { class: 'ui-btn', type: 'button', onclick: () => file.click() }, 'Import a backup…'), file),
    error,
    done,
  );
}
