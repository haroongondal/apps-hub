import { CATEGORY_IDS, DEFAULT_TAKEOVER_EXTENSIONS, DEFAULT_TAKEOVER_MIME_TYPES, type DownloadSettings } from '@apps-hub/sieve-core/src/dl-settings.ts';
import { T } from '@apps-hub/sieve-core/src/dl-text.ts';
import { toggle } from '../controls.ts';
import { h, type Child } from '../dom.ts';
import { queuesEditor } from './queues-editor.ts';
import { onDownloadsChanged, readDownloads, saveDownloads } from './settings-store.ts';

type Edit = (s: DownloadSettings) => DownloadSettings;
type Field = HTMLInputElement | HTMLTextAreaElement;

const words = (v: string) => v.split(/[\s,]+/).filter(Boolean);
let helps = 0;
const help = (text: string) => h('p', { class: 'ui-meta', id: `dl-help-${++helps}` }, text);
const described = (id: string) => (id ? { 'aria-describedby': id } : {});
const lines = (v: string) => v.split(/\n+/).map((x) => x.trim()).filter(Boolean);

export function downloadsSection(): HTMLElement {
  // Every control shows the stored value. A change from elsewhere updates it in place unless the person is in it.
  const shows: (() => void)[] = [];
  let latest: DownloadSettings | null = null;
  const follow = (s: DownloadSettings) => {
    latest = s;
    for (const show of shows) show();
  };
  onDownloadsChanged(follow);
  void readDownloads().then(follow);

  const live = (label: string, read: (s: DownloadSettings) => boolean, edit: (on: boolean) => Edit, props: Record<string, unknown> = {}): HTMLLabelElement => {
    const row = toggle(label, true, (on) => saveDownloads(edit(on)), props);
    const input = row.querySelector('input')!;
    shows.push(() => latest && (input.checked = read(latest)));
    return row;
  };

  // `commit` turns the typed text into an edit; afterwards the field shows what was stored (so a clamp is visible).
  const bind = <E extends Field>(el: E, read: (s: DownloadSettings) => string, commit: (v: string) => Edit): E => {
    el.addEventListener('change', async () => {
      await saveDownloads(commit(el.value));
      el.value = read(await readDownloads());
    });
    shows.push(() => latest && el !== document.activeElement && (el.value = read(latest)));
    return el;
  };

  // A blank number is repaired to the default, not read as 0.
  const numberField = (label: string, min: number, max: number, read: (s: DownloadSettings) => number, commit: (n: number) => Edit, step = 1, help = ''): HTMLLabelElement => {
    const input = bind(h('input', { class: 'ui-input dl-num', type: 'number', min, max, step, ...described(help) }), (s) => String(read(s)), (v) => commit(v === '' ? NaN : Number(v)));
    return h('label', { class: 'dl-field' }, h('span', {}, label), input);
  };
  const textField = (label: string, read: (s: DownloadSettings) => string, commit: (v: string) => Edit, help = ''): HTMLLabelElement =>
    h('label', { class: 'dl-field dl-text' }, h('span', {}, label), bind(h('input', { class: 'ui-input', type: 'text', spellcheck: false, ...described(help) }), read, commit));
  // The help sits beside the label, not inside it, so the control's name is just its label.
  const areaField = (label: string, text: string, rows: number, read: (s: DownloadSettings) => string, commit: (v: string) => Edit): HTMLElement => {
    const note = help(text);
    return h('div', { class: 'dl-field dl-text' }, h('label', { class: 'dl-label' }, h('span', {}, label), bind(h('textarea', { class: 'dl-area', spellcheck: false, rows, 'aria-describedby': note.id }), read, commit)), note);
  };

  const group = (title: string | null, note: HTMLElement | null, ...kids: Child[]) =>
    h('div', { class: 'dl-group' }, title && h('h3', { class: 'ui-caption' }, title), note, h('div', { class: 'ui-group dl-rows' }, ...kids));

  const takeOver = (patch: Partial<DownloadSettings['takeOver']>): Edit => (s) => ({ ...s, takeOver: { ...s.takeOver, ...patch } });
  const reset = h('button', { class: 'ui-btn', type: 'button', onclick: () => void saveDownloads(takeOver({ extensions: [...DEFAULT_TAKEOVER_EXTENSIONS], mimeTypes: [...DEFAULT_TAKEOVER_MIME_TYPES] })) }, T.setResetTypes);
  const speed = (patch: Partial<DownloadSettings['speedLimit']>): Edit => (s) => ({ ...s, speedLimit: { ...s.speedLimit, ...patch } });

  const categoriesHelp = help(T.setCategoriesHelp);
  const categories = CATEGORY_IDS.flatMap((id) => {
    const name = T.categoryNames[id];
    const at = (s: DownloadSettings) => s.categories.find((c) => c.id === id)!;
    const set = (patch: { folder?: string; extensions?: string[] }): Edit => (s) => ({ ...s, categories: s.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
    return [
      textField(T.setFolder(name), (s) => at(s).folder, (v) => set({ folder: v }), categoriesHelp.id),
      id !== 'other' && textField(T.setCategoryExt(name), (s) => at(s).extensions.join(' '), (v) => set({ extensions: words(v) }), categoriesHelp.id),
    ];
  });

  const onHelp = help(T.setOnHelp);
  const partsHelp = help(T.setPartsHelp);
  const section = h(
    'section',
    { id: 'downloads' },
    h('h2', { class: 'ui-heading' }, T.sectionTitle),
    group(null, onHelp, live(T.setOn, (s) => s.on, (on) => (s) => ({ ...s, on }), { 'aria-describedby': onHelp.id })),
    group(
      null,
      null,
      live(T.setTakeOver, (s) => s.takeOver.on, (on) => takeOver({ on })),
      numberField(T.setMinMb, 0, 100000, (s) => s.takeOver.minMb, (minMb) => takeOver({ minMb })),
      areaField(T.setExtensions, T.setExtensionsHelp, 4, (s) => s.takeOver.extensions.join(' '), (v) => takeOver({ extensions: words(v) })),
      areaField(T.setMime, T.setMimeHelp, 5, (s) => s.takeOver.mimeTypes.join('\n'), (v) => takeOver({ mimeTypes: lines(v) })),
      h('div', { class: 'dl-actions' }, reset),
    ),
    group(null, partsHelp, numberField(T.setParts, 1, 6, (s) => s.parts, (parts) => (s) => ({ ...s, parts }), 1, partsHelp.id)),
    group(
      T.setSpeed,
      null,
      live(T.limitOn, (s) => s.speedLimit.on, (on) => speed({ on })),
      numberField(T.limitValue, 10, 1_000_000, (s) => s.speedLimit.kbPerSecond, (kbPerSecond) => speed({ kbPerSecond }), 10),
    ),
    group(T.setCategories, categoriesHelp, ...categories),
    group(T.setQueues, null, queuesEditor()),
  );
  return section;
}
