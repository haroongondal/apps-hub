import { EXPERIMENT_PRESETS, parseFlagOverrides } from '@apps-hub/sieve-core/src/experiments.ts';
import { DEFAULT_YOUTUBE, YOUTUBE_GROUPS, YOUTUBE_KEY, getPath, setPath, validateYouTube, type Field, type YouTubeSettings } from '@apps-hub/sieve-core/src/youtube-settings.ts';
import { toggle } from './controls.ts';
import { h, type Child } from './dom.ts';
import { withSettingsLock } from './lock.ts';

const read = async () => validateYouTube((await chrome.storage.local.get(YOUTUBE_KEY))[YOUTUBE_KEY]);

// Resolves the stored settings after the edit, or null (logged) when storing failed. `current` is re-read inside the lock.
async function write(edit: (y: YouTubeSettings) => YouTubeSettings): Promise<YouTubeSettings | null> {
  try {
    return await withSettingsLock(async () => {
      const next = validateYouTube(edit(await read()));
      await chrome.storage.local.set({ [YOUTUBE_KEY]: next });
      return next;
    });
  } catch (e) {
    console.error('Sieve could not save the YouTube settings', e);
    return null;
  }
}
const writePath = (path: string, value: unknown) => write((y) => setPath(y, path, value));

export function youtubeSection(): HTMLElement {
  let current = DEFAULT_YOUTUBE;
  // Each control keeps how to show a stored value. `force` is for the control the owner just changed; others in use are left alone.
  const shows: ((y: YouTubeSettings, force: boolean) => void)[] = [];
  const idOf = (key: string) => `yt-${key.replace(/[^a-z0-9]+/gi, '-')}`;
  const wrap = (key: string, help: string | undefined, ...kids: Child[]) =>
    h('div', { class: 'field', 'data-path': key }, ...kids, help && h('p', { class: 'ui-meta', id: `${idOf(key)}-help` }, help));

  function switchField(f: Field): HTMLElement {
    const row = toggle(f.label, getPath(current, f.path) === true, async (on) => (await writePath(f.path, on)) !== null, { id: idOf(f.path), ...(f.help ? { 'aria-describedby': `${idOf(f.path)}-help` } : {}) });
    const input = row.querySelector('input')!;
    shows.push((y) => (input.checked = getPath(y, f.path) === true));
    return wrap(f.path, f.help, row);
  }

  function inputField(f: Field & { kind: 'number' | 'select' | 'color' }): HTMLElement {
    const id = idOf(f.path);
    const el: HTMLInputElement | HTMLSelectElement =
      f.kind === 'select'
        ? h('select', { class: 'ui-select', id }, ...f.options.map((o) => h('option', { value: o.value }, o.label)))
        : h('input', { class: f.kind === 'number' ? 'ui-input' : 'color', id, type: f.kind, ...(f.kind === 'number' && { min: f.min, max: f.max, step: f.step }) });
    if (f.help) el.setAttribute('aria-describedby', `${id}-help`);
    const show = (y: YouTubeSettings, force: boolean) => {
      if (force || el !== document.activeElement || f.kind === 'select') el.value = String(getPath(y, f.path));
    };
    el.addEventListener('change', async () => {
      const value = f.kind === 'number' ? (el as HTMLInputElement).valueAsNumber : el.value;
      show((await writePath(f.path, value)) ?? current, true);
    });
    shows.push(show);
    return wrap(f.path, f.help, h('label', { for: id }, f.label), h('span', { class: 'inputs' }, el, f.kind === 'number' && f.unit && h('span', { class: 'ui-meta' }, f.unit)));
  }

  function textField(f: Field & { kind: 'text' }): HTMLElement {
    const id = idOf(f.path);
    let edited = false;
    let loaded = '';
    const area = h('textarea', { class: 'filters', id, spellcheck: false, rows: f.path === 'theme.css' ? 8 : 4, maxLength: f.maxLength, oninput: () => (edited = true) });
    if (f.help) area.setAttribute('aria-describedby', `${id}-help`);
    const result = h('div', { class: 'yt-result', role: 'status', 'aria-live': 'polite' });
    const save = h('button', { class: 'ui-btn ui-btn--primary', type: 'button', onclick: () => void saveText() }, 'Save');
    async function saveText(): Promise<void> {
      const text = area.value;
      save.disabled = true;
      const next = await writePath(f.path, text);
      save.disabled = false;
      if (next === null) return void result.replaceChildren(h('p', { class: 'error' }, "Sieve couldn't save this. Reload this page, then try again."));
      loaded = getPath(next, f.path) as string;
      edited = area.value !== text;
      if (!edited) area.value = loaded;
      const errors = f.path === 'experiments.overrides' ? parseFlagOverrides(text).errors : [];
      result.replaceChildren(
        h('p', {}, errors.length ? 'Saved. Sieve ignores the lines listed here.' : 'Saved.'),
        ...(errors.length ? [h('ul', { class: 'yt-errors' }, ...errors.map((e) => h('li', {}, `Line ${e.line}: ${e.reason}`)))] : []),
      );
    }
    shows.push((y) => {
      const text = getPath(y, f.path) as string;
      if (text === loaded || (edited && text !== area.value)) return;
      area.value = loaded = text;
      edited = false;
    });
    return wrap(f.path, f.help, h('label', { for: id }, f.label), area, h('div', { class: 'row' }, save), result);
  }

  function presetSwitch(p: (typeof EXPERIMENT_PRESETS)[number]): HTMLElement {
    const has = (y: YouTubeSettings) => y.experiments.presets.includes(p.id);
    const row = toggle(`Block ${p.label}`, has(current), async (on) => {
      const next = await write((y) => ({ ...y, experiments: { ...y.experiments, presets: [...y.experiments.presets.filter((id) => id !== p.id), ...(on ? [p.id] : [])] } }));
      return next !== null;
    });
    const input = row.querySelector('input')!;
    shows.push((y) => (input.checked = has(y)));
    return h('div', { class: 'field', 'data-preset': p.id }, row);
  }

  const fieldFor = (f: Field) => (f.kind === 'switch' ? switchField(f) : f.kind === 'text' ? textField(f) : inputField(f));
  const groups = YOUTUBE_GROUPS.map((g) =>
    h(
      'div',
      { class: 'yt-group' },
      g.id !== 'tools' && h('h3', { class: 'ui-heading yt-sub' }, g.title),
      g.help && h('p', { class: 'ui-meta' }, g.help),
      h('div', { class: 'ui-group rows fields' }, ...(g.id === 'experiments' ? EXPERIMENT_PRESETS.map(presetSwitch) : []), ...g.fields.map(fieldFor)),
    ),
  );
  const [tools, ...rest] = groups;
  const stack = h('div', { class: 'yt-rest', inert: !current.on }, ...rest);

  const apply = (y: YouTubeSettings, force = false) => {
    current = y;
    stack.inert = !y.on;
    for (const show of shows) show(y, force);
  };
  apply(current, true);
  void read().then((y) => apply(y, true), (e) => console.error('Sieve could not read the YouTube settings', e));
  chrome.storage.onChanged.addListener((changes, where) => {
    if (where === 'local' && YOUTUBE_KEY in changes) apply(validateYouTube(changes[YOUTUBE_KEY].newValue));
  });

  return h('section', { id: 'youtube' }, h('h2', { class: 'ui-heading' }, 'YouTube'), tools, stack);
}
