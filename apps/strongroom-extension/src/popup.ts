import type { Detail, ImportPreview, PageRef, Pending, Request, Row, Status } from './service.ts';

type Child = Node | string | null | false | undefined;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value as EventListener);
    else if (key === 'class') el.className = String(value);
    else if (key in el) (el as unknown as Record<string, unknown>)[key] = value;
    else el.setAttribute(key, String(value));
  }
  el.append(...kids.filter((k): k is Node | string => k !== null && k !== false && k !== undefined));
  return el;
}

async function call<T = unknown>(req: Request | { type: string }): Promise<T> {
  const reply = await chrome.runtime.sendMessage(req);
  if (!reply?.ok) throw new Error(reply?.error ?? 'Strongroom did not answer. Close this window and try again.');
  return reply.data as T;
}

const root = document.getElementById('app')!;
let tab: PageRef | null = null;

const msgBox = () => h('p', { class: 'ui-meta msg', role: 'alert' });
const label = (text: string, input: HTMLElement) => h('label', { class: 'ui-field' }, h('span', { class: 'ui-caption' }, text), input);
const input = (props: Record<string, unknown> = {}) => h('input', { class: 'ui-input', autocomplete: 'off', spellcheck: false, ...props });
const button = (text: string, onclick: () => unknown, kind = '') => h('button', { class: `ui-btn ${kind}`.trim(), type: 'button', onclick }, text);

async function guarded(msg: HTMLElement, buttons: HTMLButtonElement[], work: () => Promise<unknown>) {
  msg.textContent = '';
  buttons.forEach((b) => (b.disabled = true));
  try {
    await work();
  } catch (e) {
    msg.textContent = e instanceof Error ? e.message : String(e);
    buttons.forEach((b) => (b.disabled = false));
  }
}

function screen(title: string, back: (() => unknown) | null, ...kids: Child[]) {
  root.replaceChildren(
    h('header', { class: 'bar' }, back && button('Back', back, 'ui-btn--ghost'), h('h1', { class: 'ui-heading' }, title)),
    h('div', { class: 'stack' }, ...kids),
  );
}

async function copy(text: string, what: string, toast: HTMLElement) {
  await navigator.clipboard.writeText(text);
  toast.textContent = `${what} copied. Your clipboard keeps it until you copy something else.`;
}

async function route() {
  const status = await call<Status>({ type: 'status' });
  if (status.recoveryKey) return recoveryScreen(status.recoveryKey);
  if (status.state === 'no-vault') return setupScreen();
  if (status.state === 'locked') return unlockScreen();
  return vaultScreen();
}

function setupScreen() {
  const msg = msgBox();
  const pw = input({ type: 'password', autocomplete: 'new-password' });
  const again = input({ type: 'password', autocomplete: 'new-password' });
  const go = button('Create vault', () => guarded(msg, [go], async () => {
    if (pw.value !== again.value) throw new Error("The two passwords don't match. Type the same one twice.");
    await call({ type: 'setup', password: pw.value });
    await route();
  }), 'ui-btn--primary');
  screen('Create your vault', null,
    h('p', { class: 'ui-muted' }, 'Your logins are encrypted on this computer with your master password. Nothing leaves it.'),
    label('Master password (at least 12 characters)', pw), label('Type it again', again), msg, go);
}

function recoveryScreen(key: string) {
  const msg = msgBox();
  const group = input({ placeholder: 'First four characters', maxLength: 4 });
  const done = button("I've saved it", () => guarded(msg, [done], async () => {
    await call({ type: 'confirmRecovery', group: group.value });
    await route();
  }), 'ui-btn--primary');
  screen('Save your recovery key', null,
    h('p', { class: 'ui-muted' }, "Write this down or print it. It's the only way back in if you forget your master password, and anyone who has it can open your vault. It's shown once."),
    h('p', { class: 'ui-mono key' }, key), label('Type the first group to show you saved it', group), msg, done);
}

async function unlockScreen() {
  const msg = msgBox();
  const pw = input({ type: 'password', autocomplete: 'current-password', autofocus: true });
  const pending = tab && await call<Pending | null>({ type: 'pending', tabId: tab.tabId });
  const go = button('Unlock', () => guarded(msg, [go], async () => {
    await call({ type: 'unlock', password: pw.value });
    await route();
  }), 'ui-btn--primary');
  pw.addEventListener('keydown', (e) => e.key === 'Enter' && go.click());
  screen('Unlock Strongroom', null,
    pending && h('p', { class: 'ui-muted' }, `After you unlock, you can save the sign-in you just used on ${pending.host}.`),
    label('Master password', pw), msg, go, button('Forgot master password?', resetScreen, 'ui-btn--ghost'));
}

function resetScreen() {
  const msg = msgBox();
  const key = input({ placeholder: 'ABCD-EFGH-…' });
  const pw = input({ type: 'password', autocomplete: 'new-password' });
  const again = input({ type: 'password', autocomplete: 'new-password' });
  const go = button('Set new master password', () => guarded(msg, [go], async () => {
    if (pw.value !== again.value) throw new Error("The two passwords don't match. Type the same one twice.");
    await call({ type: 'recover', recoveryKey: key.value, password: pw.value });
    await route();
  }), 'ui-btn--primary');
  screen('Reset master password', unlockScreen, label('Recovery key', key), label('New master password (at least 12 characters)', pw), label('Type it again', again), msg, go);
}

async function vaultScreen() {
  const [{ rows, unreadable }, pending, here] = await Promise.all([
    call<{ rows: Row[]; unreadable: number }>({ type: 'list' }),
    tab ? call<Pending | null>({ type: 'pending', tabId: tab.tabId }) : null,
    tab ? call<{ rows: Row[] }>({ type: 'candidates', page: tab }) : null,
  ]);
  const toast = h('p', { class: 'ui-meta', role: 'status' });
  const msg = msgBox();
  const list = h('div', { class: 'list' });
  const search = input({ type: 'search', placeholder: 'Search logins' });

  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = rows.filter((r) => `${r.name} ${r.username} ${r.sites.join(' ')}`.toLowerCase().includes(q));
    list.replaceChildren(...(shown.length ? shown.map((r) => h('button', { class: 'row', type: 'button', onclick: () => detailScreen(r.id) },
      h('span', { class: 'name' }, r.name, r.flagged && h('span', { class: 'ui-pill ui-pill--warn' }, 'Review')),
      h('span', { class: 'ui-meta' }, [r.username, r.sites[0] ?? (r.apps ? 'App login' : '')].filter(Boolean).join(' · ')))) : [h('p', { class: 'ui-muted' }, rows.length ? 'No logins match your search.' : 'No logins yet. Add one or import from Google.')]));
  };
  search.addEventListener('input', draw);
  draw();

  const pendingCard = pending && !pending.locked && h('div', { class: 'ui-group card' },
    h('p', {}, pending.intent === 'update' ? `Update the password for ${pending.name} (${pending.username}) from ${pending.host}?` : `Save the login for ${pending.host}${pending.username ? ` (${pending.username})` : ''}?`),
    h('div', { class: 'ui-toolbar' },
      button(pending.intent === 'update' ? 'Update' : 'Save', () => guarded(msg, [], async () => { await call({ type: 'resolvePending', tabId: tab!.tabId, action: 'save' }); await vaultScreen(); }), 'ui-btn--primary'),
      button('Not now', () => guarded(msg, [], async () => { await call({ type: 'resolvePending', tabId: tab!.tabId, action: 'dismiss' }); await vaultScreen(); }))));

  const hereCard = here && here.rows.length > 0 && h('div', { class: 'ui-group card' },
    h('p', { class: 'ui-caption' }, 'For this site'),
    ...here.rows.map((r) => h('div', { class: 'ui-toolbar here' }, h('span', { class: 'grow' }, `${r.name}${r.username ? ` · ${r.username}` : ''}`),
      button('Fill', () => guarded(msg, [], async () => {
        const reply = await chrome.tabs.sendMessage(tab!.tabId, { type: 'fillForm', id: r.id });
        if (!reply?.filled) throw new Error("This page didn't take the login. Open the site's sign-in page and try again.");
        window.close();
      })),
      button('Copy password', () => guarded(msg, [], async () => copy((await call<Detail>({ type: 'get', id: r.id })).password, 'Password', toast))))));

  screen('Strongroom', null,
    h('div', { class: 'ui-toolbar' }, button('Add', () => editScreen(null), 'ui-btn--primary'), button('Import', importScreen),
      h('span', { class: 'grow' }), button('Lock', () => guarded(msg, [], async () => { await call({ type: 'lock' }); await route(); }), 'ui-btn--ghost')),
    pendingCard, hereCard, search, list,
    unreadable > 0 && h('p', { class: 'ui-meta' }, `${unreadable} saved item${unreadable === 1 ? '' : 's'} couldn't be read and ${unreadable === 1 ? 'was' : 'were'} left untouched.`),
    toast, msg);
}

async function detailScreen(id: string) {
  const d = await call<Detail>({ type: 'get', id });
  const toast = h('p', { class: 'ui-meta', role: 'status' });
  const msg = msgBox();
  const shown = h('span', { class: 'ui-mono' }, '••••••••••');
  let revealed = false;
  const toggle = button('Show', () => {
    revealed = !revealed;
    shown.textContent = revealed ? d.password : '••••••••••';
    toggle.textContent = revealed ? 'Hide' : 'Show';
  });
  let sure = false;
  const del = button('Delete', () => guarded(msg, [del], async () => {
    if (!sure) {
      sure = true;
      del.textContent = 'Tap again to delete';
      del.disabled = false;
      return;
    }
    await call({ type: 'remove', id });
    await vaultScreen();
  }), 'ui-btn--danger');
  const line = (name: string, ...kids: Child[]) => h('div', { class: 'ui-field' }, h('span', { class: 'ui-caption' }, name), h('div', { class: 'ui-toolbar' }, ...kids));
  screen(d.name, vaultScreen,
    line('Username', h('span', { class: 'grow' }, d.username || 'None'), d.username && button('Copy', () => copy(d.username, 'Username', toast))),
    line('Password', h('span', { class: 'grow' }, shown), toggle, button('Copy', () => copy(d.password, 'Password', toast))),
    d.websites && line('Websites', h('span', { class: 'grow pre' }, d.websites)),
    d.note && line('Note', h('span', { class: 'grow pre' }, d.note)),
    h('div', { class: 'ui-toolbar' }, button('Edit', () => editScreen(d), 'ui-btn--primary'), del), toast, msg);
}

function editScreen(d: Detail | null) {
  const msg = msgBox();
  const name = input({ value: d?.name ?? '' });
  const user = input({ value: d?.username ?? '' });
  const pw = input({ type: 'password', value: d?.password ?? '', autocomplete: 'new-password' });
  const sites = h('textarea', { class: 'ui-input', rows: 2, value: d?.websites ?? (tab?.url?.startsWith('http') ? new URL(tab.url).origin : ''), placeholder: 'https://example.com' });
  const note = h('textarea', { class: 'ui-input', rows: 2, value: d?.note ?? '' });
  const show = button('Show', () => {
    pw.type = pw.type === 'password' ? 'text' : 'password';
    show.textContent = pw.type === 'password' ? 'Show' : 'Hide';
  });
  const save = button('Save', () => guarded(msg, [save], async () => {
    const { id } = await call<{ id: string }>({ type: 'save', id: d?.id ?? null, login: { name: name.value, username: user.value, password: pw.value, websites: sites.value, note: note.value } });
    await detailScreen(id);
  }), 'ui-btn--primary');
  screen(d ? 'Edit login' : 'Add login', d ? () => detailScreen(d.id) : vaultScreen,
    label('Name', name), label('Username', user), label('Password', h('div', { class: 'ui-toolbar' }, pw, show)),
    label('Websites (one per line)', sites), label('Note', note), msg, save);
}

function importScreen() {
  const msg = msgBox();
  const file = h('input', { type: 'file', accept: '.csv,text/csv', class: 'ui-input' });
  const out = h('div', { class: 'stack' });
  file.addEventListener('change', () => guarded(msg, [], async () => {
    const csv = await file.files![0].text();
    const preview = await call<ImportPreview>({ type: 'import', csv, commit: false });
    const go = button(`Import ${preview.added} logins`, () => guarded(msg, [go], async () => {
      await call({ type: 'import', csv, commit: true });
      out.replaceChildren(h('p', {}, `Imported ${preview.added} logins.`), h('p', { class: 'ui-muted' }, 'Delete the exported file now. It holds your passwords in plain text.'), button('Done', vaultScreen, 'ui-btn--primary'));
    }), 'ui-btn--primary');
    out.replaceChildren(h('p', {}, `${preview.added + preview.merged} logins found, ${preview.merged} duplicates merged${preview.flagged ? `, ${preview.flagged} need review` : ''}.`), go);
  }));
  screen('Import from Google', vaultScreen,
    h('p', { class: 'ui-muted' }, 'In Google Password Manager choose Settings, then Export passwords, and pick the file here. Import it once: importing twice adds every login again.'),
    file, msg, out);
}

async function main() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  tab = active?.id !== undefined && active.url ? { tabId: active.id, url: active.url } : null;
  await route();
}

main().catch((e) => root.replaceChildren(h('p', { class: 'ui-meta msg', role: 'alert' }, e instanceof Error ? e.message : String(e))));
