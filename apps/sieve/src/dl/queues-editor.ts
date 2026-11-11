import { DOWNLOADS_KEY, MAX_QUEUES, validateDownloadSettings, type DownloadSettings, type QueueSetting } from '@apps-hub/sieve-core/src/dl-settings.ts';
import { T } from '@apps-hub/sieve-core/src/dl-text.ts';
import { toggle } from '../controls.ts';
import { h } from '../dom.ts';
import { readDownloads, saveDownloads } from './settings-store.ts';

interface Parts {
  box: HTMLFieldSetElement;
  legend: HTMLElement;
  name: HTMLInputElement;
  parallel: HTMLInputElement;
  use: HTMLInputElement;
  days: HTMLInputElement[];
  start: HTMLInputElement;
  stop: HTMLInputElement;
  noStop: HTMLInputElement;
  remove: HTMLButtonElement | null;
  removeText: HTMLElement | null;
}

// Shared by the scheduler dialog and the settings page. Every control writes through saveDownloads (which repairs values)
// and the editor follows storage changes, leaving a focused control alone. Handlers read their control before the write
// starts: inside the lock a storage change may already have reset the control.
export function queuesEditor(): HTMLElement {
  const parts = new Map<string, Parts>();
  let built: string[] = [];
  const list = h('div', { class: 'dl-queues' });
  const add: HTMLButtonElement = h('button', { type: 'button', class: 'ui-btn', onclick: () => void saveDownloads(addQueue).then(() => sync()) }, T.setAddQueue);
  const root = h('div', { class: 'dl-queues-editor' }, list, add);

  const addQueue = (s: DownloadSettings): DownloadSettings => {
    if (s.queues.length >= MAX_QUEUES) return s;
    const used = new Set(s.queues.map((q) => q.id));
    let n = s.queues.length + 1;
    while (used.has(`q${n}`)) n++;
    const queue: QueueSetting = { id: `q${n}`, name: `Queue ${n}`, maxParallel: 3, schedule: { on: false, days: [0, 1, 2, 3, 4, 5, 6], start: '01:00', stop: '07:00' } };
    return { ...s, queues: [...s.queues, queue] };
  };
  const edit = (id: string, fn: (q: QueueSetting) => QueueSetting) => saveDownloads((s) => ({ ...s, queues: s.queues.map((q) => (q.id === id ? fn(q) : q)) }));
  // After a write the control shows the stored (repaired) value, even though it still has focus.
  const sync = async (force?: Element) => apply(await readDownloads(), force);

  function build(q: QueueSetting, index: number): Parts {
    const id = q.id;
    const field = (label: string, control: HTMLElement) => h('label', { class: 'ui-field' }, h('span', { class: 'ui-caption' }, label), control);
    const name = h('input', { type: 'text', class: 'ui-input', onchange: () => {
      const value = name.value;
      void edit(id, (x) => ({ ...x, name: value })).then(() => sync(name));
    } });
    const parallel = h('input', { type: 'number', class: 'ui-input', min: 1, max: 8, step: 1, onchange: () => {
      const value = parallel.valueAsNumber;
      void edit(id, (x) => ({ ...x, maxParallel: value || x.maxParallel })).then(() => sync(parallel));
    } });
    const useLabel = toggle(T.scheduleUse, false, (on) => edit(id, (x) => ({ ...x, schedule: { ...x.schedule, on } })));
    const days = T.days.map((label, d) => {
      const box = h('input', {
        type: 'checkbox',
        onchange: () => {
          const checked = box.checked;
          void edit(id, (x) => ({ ...x, schedule: { ...x.schedule, days: [...new Set([...x.schedule.days.filter((v) => v !== d), ...(checked ? [d] : [])])].sort() } })).then(() => sync(box));
        },
      });
      return Object.assign(box, { label });
    });
    const start = h('input', { type: 'time', class: 'ui-input', onchange: () => {
      const value = start.value;
      void edit(id, (x) => ({ ...x, schedule: { ...x.schedule, start: value || x.schedule.start } })).then(() => sync(start));
    } });
    const stop = h('input', { type: 'time', class: 'ui-input', value: '07:00', onchange: () => {
      const value = stop.value;
      void edit(id, (x) => ({ ...x, schedule: { ...x.schedule, stop: value || null } })).then(() => sync(stop));
    } });
    const noStop = h('input', {
      type: 'checkbox',
      onchange: () => {
        const none = noStop.checked;
        const value = stop.value || '07:00';
        void edit(id, (x) => ({ ...x, schedule: { ...x.schedule, stop: none ? null : value } })).then(() => sync(noStop));
      },
    });
    const removeText = index === 0 ? null : h('span', {}, T.setRemoveQueue(q.name));
    const remove = removeText && h('button', { type: 'button', class: 'ui-btn', onclick: () => void saveDownloads((s) => ({ ...s, queues: s.queues.filter((x, i) => i === 0 || x.id !== id) })).then(() => sync()) }, removeText);
    const legend = h('legend', { class: 'ui-heading' }, q.name);
    const box = h(
      'fieldset',
      { class: 'dl-queue', 'data-queue': id },
      legend,
      field(T.setQueueName, name),
      field(T.scheduleParallel, parallel),
      useLabel,
      h('div', { class: 'dl-days', role: 'group' }, ...days.map((d) => h('label', { class: 'dl-day' }, d, d.label))),
      h('div', { class: 'dl-times' }, field(T.scheduleStart, start), field(T.scheduleStop, stop)),
      h('label', { class: 'dl-day' }, noStop, T.scheduleNoStop),
      remove,
    );
    return { box, legend, name, parallel, use: useLabel.querySelector('input')!, days, start, stop, noStop, remove, removeText };
  }

  function apply(s: DownloadSettings, force?: Element) {
    const ids = s.queues.map((q) => q.id);
    if (ids.join() !== built.join()) {
      parts.clear();
      s.queues.forEach((q, i) => parts.set(q.id, build(q, i)));
      list.replaceChildren(...s.queues.map((q) => parts.get(q.id)!.box));
      built = ids;
    }
    // A control being edited keeps what the person typed, unless it is the one that was just written.
    const put = (el: HTMLInputElement, set: () => void) => el !== document.activeElement || el === force ? set() : undefined;
    for (const q of s.queues) {
      const p = parts.get(q.id)!;
      p.legend.textContent = q.name;
      if (p.removeText) p.removeText.textContent = T.setRemoveQueue(q.name);
      put(p.name, () => (p.name.value = q.name));
      put(p.parallel, () => (p.parallel.value = String(q.maxParallel)));
      put(p.use, () => (p.use.checked = q.schedule.on));
      p.days.forEach((box, d) => put(box, () => (box.checked = q.schedule.days.includes(d))));
      put(p.start, () => (p.start.value = q.schedule.start));
      if (q.schedule.stop !== null) put(p.stop, () => (p.stop.value = q.schedule.stop!));
      put(p.noStop, () => (p.noStop.checked = q.schedule.stop === null));
      p.stop.disabled = q.schedule.stop === null;
    }
    add.disabled = s.queues.length >= MAX_QUEUES;
  }

  let wasConnected = false;
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (root.isConnected) wasConnected = true;
    else if (wasConnected) return chrome.storage.onChanged.removeListener(onStorage);
    if (area === 'local' && DOWNLOADS_KEY in changes) apply(validateDownloadSettings(changes[DOWNLOADS_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(onStorage);
  void sync();
  return root;
}
