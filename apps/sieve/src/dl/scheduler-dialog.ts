import { T } from '@apps-hub/sieve-core/src/dl-text.ts';
import { h } from '../dom.ts';
import { queuesEditor } from './queues-editor.ts';

export function openSchedulerDialog(): void {
  if (document.getElementById('dl-scheduler-dialog')) return;
  const dialog = h(
    'dialog',
    { id: 'dl-scheduler-dialog', class: 'ui-sheet dl-dialog dl-dialog--wide', 'aria-labelledby': 'dl-scheduler-title' },
    h('div', { class: 'dl-form' }, h('h2', { class: 'ui-heading', id: 'dl-scheduler-title' }, T.schedulerTitle), queuesEditor(), h('div', { class: 'dl-actions' }, h('button', { type: 'button', class: 'ui-btn', onclick: () => dialog.close() }, T.close))),
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
