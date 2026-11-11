import { CATEGORY_IDS } from '@apps-hub/sieve-core/src/dl-settings.ts';
import type { AddItem } from '@apps-hub/sieve-core/src/dl-record.ts';
import { T } from '@apps-hub/sieve-core/src/dl-text.ts';
import { parseAddInput } from '@apps-hub/sieve-core/src/dl-view.ts';
import { h } from '../dom.ts';
import { readDownloads } from './settings-store.ts';

// The page's status line (list.ts) is the element with this id; a skipped-lines note goes there after a successful add.
export const STATUS_ID = 'dl-status';

export async function openAddDialog(opts: { urls?: string[]; referrer?: string } = {}): Promise<void> {
  const settings = await readDownloads();
  const title = h('h2', { class: 'ui-heading', id: 'dl-add-title' }, T.addTitle);
  const text = h('textarea', { id: 'dl-add-text', class: 'ui-input dl-textarea', rows: 6, value: (opts.urls ?? []).join('\n'), spellcheck: false });
  const queue = h('select', { id: 'dl-add-queue', class: 'ui-select' }, ...settings.queues.map((q) => h('option', { value: q.id }, q.name)));
  const category = h('select', { id: 'dl-add-category', class: 'ui-select' }, h('option', { value: '' }, T.addAutomatic), ...CATEGORY_IDS.map((id) => h('option', { value: id }, T.categoryNames[id])));
  const message = h('p', { class: 'dl-error', role: 'alert' });
  const field = (label: string, control: HTMLElement) => h('label', { class: 'ui-field' }, h('span', { class: 'ui-caption' }, label), control);
  const submit = h('button', { type: 'submit', class: 'ui-btn ui-btn--primary' }, T.addSubmit);
  const cancel = h('button', { type: 'button', class: 'ui-btn', onclick: () => dialog.close() }, T.cancel);
  const form = h('form', { class: 'dl-form', method: 'dialog' }, title, field(T.addLabel, text), field(T.addQueue, queue), field(T.addCategory, category), message, h('div', { class: 'dl-actions' }, cancel, submit));
  const dialog = h('dialog', { class: 'ui-sheet dl-dialog', 'aria-labelledby': 'dl-add-title' }, form);
  document.body.append(dialog);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { urls, skipped } = parseAddInput(text.value);
    message.textContent = '';
    if (urls.length === 0) {
      message.textContent = T.addNone;
      return;
    }
    submit.disabled = true;
    const items: AddItem[] = urls.map((url) => ({
      url,
      referrer: opts.referrer ?? '',
      queue: queue.value,
      ...(category.value ? { category: category.value as AddItem['category'] } : {}),
      source: opts.urls ? 'menu' : 'manual',
    }));
    const reply = await chrome.runtime.sendMessage({ type: 'dl-add', items }).catch(() => null);
    submit.disabled = false;
    if (!reply?.ok) {
      message.textContent = reply?.message ?? T.addFailed;
      return;
    }
    const status = document.getElementById(STATUS_ID);
    if (status) status.textContent = skipped > 0 ? T.addSkipped(skipped) : '';
    dialog.close();
  });

  return new Promise((done) => {
    dialog.addEventListener('close', () => (dialog.remove(), done()));
    dialog.showModal();
    text.focus();
  });
}
