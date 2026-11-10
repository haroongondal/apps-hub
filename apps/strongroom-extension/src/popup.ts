import type { Detail, EmailRecoveryStatus, ImportPreview, LostAccessState, PageRef, Pending, Request, Row, Status, SyncStatus } from './service.ts';
import { syncLines } from './sync-copy.ts';

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
// Chrome closes the toolbar popup when the file picker opens, so Import runs in a full tab (popup.html#import).
const inImportTab = () => location.hash === '#import';
let importNext = false;

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
  if (importNext) {
    importNext = false;
    return importScreen();
  }
  return vaultScreen();
}

async function setupScreen() {
  const { available } = await call<SyncStatus>({ type: 'syncStatus' });
  const msg = msgBox();
  const pw = input({ type: 'password', autocomplete: 'new-password' });
  const again = input({ type: 'password', autocomplete: 'new-password' });
  const go = button('Create vault', () => guarded(msg, [go], async () => {
    if (pw.value !== again.value) throw new Error("The two passwords don't match. Type the same one twice.");
    await call({ type: 'setup', password: pw.value });
    await route();
  }), 'ui-btn--primary');
  screen('Create your vault', null,
    h('p', { class: 'ui-muted' }, available
      ? 'Your logins are encrypted on this computer with your master password. If you sign in to sync later, only the encrypted data goes to your own vault server.'
      : 'Your logins are encrypted on this computer with your master password, and they stay here.'),
    label('Master password (at least 12 characters)', pw), label('Type it again', again), msg, go,
    available && button('Use my Strongroom account instead', () => signInScreen(setupScreen), 'ui-btn--ghost'));
}

type Confirm = { needsConfirm: true; entries: number } | null;
const sameKey = (a: string, b: string) => a.replace(/[-\s]/g, '').toUpperCase() === b.replace(/[-\s]/g, '').toUpperCase();

function confirmReplace(entries: number, back: () => unknown, replace: () => Promise<unknown>) {
  const msg = msgBox();
  const yes = button('Replace and sign in', () => guarded(msg, [yes, no], replace), 'ui-btn--danger');
  const no = button('Cancel', back);
  const items = `${entries} saved ${entries === 1 ? 'item' : 'items'}`;
  screen('Replace this vault?', null,
    h('p', {}, `This computer's vault holds ${items}. Signing in replaces ${entries === 1 ? 'it' : 'them'} with the logins from your Strongroom account.`),
    h('p', { class: 'ui-muted' }, "What's here now can't be brought back."), msg, yes, no);
}

function signInScreen(back: () => unknown) {
  const msg = msgBox();
  const pw = input({ type: 'password', autocomplete: 'current-password' });
  const key = input({ placeholder: 'ABCD-EFGH-…' });
  const send = (replace: boolean) => async () => {
    const reply = await call<Confirm>({ type: 'signIn', password: pw.value, accountKey: key.value, replace });
    if (reply) confirmReplace(reply.entries, () => signInScreen(back), send(true));
    else await route();
  };
  const go = button('Sign in', () => guarded(msg, [go], send(false)), 'ui-btn--primary');
  pw.addEventListener('keydown', (e) => e.key === 'Enter' && go.click());
  screen('Sign in to sync', back,
    h('p', { class: 'ui-muted' }, 'Use the master password and account key from your phone. Strongroom was set up there first.'),
    label('Master password', pw), label('Account key', key), msg, go,
    button('Forgot master password?', () => recoverySignInScreen(back), 'ui-btn--ghost'),
    button('Lost access to your account?', () => lostAccessScreen(back), 'ui-btn--ghost'));
}

async function lostAccessScreen(back: () => unknown) {
  const msg = msgBox();
  const state = await call<LostAccessState>({ type: 'lostAccess', action: 'check' }).catch(() => null);
  if (state === null) {
    const retry = button('Try again', () => guarded(msg, [retry], () => lostAccessScreen(back)), 'ui-btn--primary');
    screen('Lost access', back, h('p', { class: 'ui-muted' }, "Couldn't check its status just now. Try again."), msg, retry);
    return;
  }
  if (state.state === 'ready') return lostAccessOpenScreen(back);
  const startOver = async () => {
    await call({ type: 'lostAccess', action: 'request' });
    await lostAccessScreen(back);
  };
  if (state.state === 'waiting') {
    const again = button('Check again', () => guarded(msg, [again], () => lostAccessScreen(back)), 'ui-btn--primary');
    // A known releaseAt means the server already confirmed this exact claim is alive and counting down: there is no good reason to let it be forgotten client-side, so no way to replace it is offered here.
    if (state.releaseAt !== null) {
      screen('Lost access', back, h('p', {}, `Confirmed by email. Strongroom lets you back in at ${new Date(state.releaseAt).toLocaleString()}.`), msg, again);
      return;
    }
    let sure = false;
    const request = button('Start a new request', () => guarded(msg, [request], async () => {
      if (!sure) {
        sure = true;
        request.textContent = 'Yes, start a new request';
        request.disabled = false;
        return;
      }
      await startOver();
    }), 'ui-btn--danger');
    screen('Lost access', back,
      h('p', {}, 'Check your email and open the confirm link. The 24-hour wait starts once you do.'), msg, again,
      h('p', { class: 'ui-muted' },
        "If you already sent a request and are waiting for the confirmation email, starting over won't reach the server and you'll need to wait the full time again from a fresh request. Only do this if you're sure the earlier request failed, was cancelled, or never arrived."),
      request);
    return;
  }
  const go = button('Request access by email', () => guarded(msg, [go], startOver), 'ui-btn--primary');
  screen('Lost access', back,
    h('p', { class: 'ui-muted' }, "If you turned on email recovery, this asks by email. You'll need the code it mailed you when you turned it on, and a 24-hour wait that another signed-in device can cancel."),
    msg, go);
}

function lostAccessOpenScreen(back: () => unknown) {
  const msg = msgBox();
  const code = input({ placeholder: 'ABCD-EFGH-…' });
  const pw = input({ type: 'password', autocomplete: 'new-password' });
  const again = input({ type: 'password', autocomplete: 'new-password' });
  const send = (replace: boolean) => async () => {
    const reply = await call<Confirm>({ type: 'lostAccess', action: 'open', code: code.value, newPassword: pw.value, replace });
    if (reply) confirmReplace(reply.entries, () => lostAccessOpenScreen(back), send(true));
    else await route();
  };
  const go = button('Open and sign in', () => guarded(msg, [go], async () => {
    if (pw.value !== again.value) throw new Error("The two passwords don't match. Type the same one twice.");
    await send(false)();
  }), 'ui-btn--primary');
  screen('Lost access', back,
    h('p', { class: 'ui-muted' }, 'Type the code from the email you got when you turned on email recovery, and set a new master password.'),
    label('Code from the email', code), label('New master password (at least 12 characters)', pw), label('Type it again', again), msg, go);
}

function recoverySignInScreen(back: () => unknown) {
  const msg = msgBox();
  const recovery = input({ placeholder: 'ABCD-EFGH-…' });
  const pw = input({ type: 'password', autocomplete: 'new-password' });
  const again = input({ type: 'password', autocomplete: 'new-password' });
  const key = input({ placeholder: 'ABCD-EFGH-…' });
  const keyAgain = input({ placeholder: 'ABCD-EFGH-…' });
  const send = (replace: boolean) => async () => {
    const reply = await call<Confirm>({ type: 'signInRecovery', recoveryKey: recovery.value, newPassword: pw.value, accountKey: key.value, replace });
    if (reply) confirmReplace(reply.entries, () => recoverySignInScreen(back), send(true));
    else await route();
  };
  const go = button('Set new master password and sign in', () => guarded(msg, [go], async () => {
    if (pw.value !== again.value) throw new Error("The two passwords don't match. Type the same one twice.");
    if (!sameKey(key.value, keyAgain.value)) throw new Error("The two account keys don't match. Type the same one twice.");
    await send(false)();
  }), 'ui-btn--primary');
  screen('Sign in with your recovery key', () => signInScreen(back),
    h('p', { class: 'ui-muted' }, "Strongroom can't check the account key against the vault server, and a typo would stop your other devices from syncing. Type it twice."),
    label('Recovery key', recovery), label('New master password (at least 12 characters)', pw), label('Type it again', again),
    label('Account key', key), label('Type the account key again', keyAgain), msg, go);
}

function syncCard(sync: SyncStatus, refresh: () => unknown) {
  const msg = msgBox();
  const now = button('Sync now', () => guarded(msg, [now], async () => {
    await call({ type: 'syncNow' });
    await refresh();
  }));
  const signIn = (text: string) => button(text, () => signInScreen(refresh), 'ui-btn--primary');
  const lines = syncLines(sync, (at) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  const action = !sync.available ? null : sync.state === 'off' ? signIn('Sign in to sync') : sync.state === 'needsSignIn' ? signIn('Sign in again') : now;
  const card = h('div', { class: 'ui-group card', id: 'sync' }, h('p', { class: 'ui-caption' }, 'Sync'), ...lines.map((l) => h('p', {}, l)), action, msg);
  if (sync.state === 'syncing') void whenSyncDone(card, refresh);
  return card;
}

async function whenSyncDone(card: HTMLElement, refresh: () => unknown) {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (!card.isConnected) return;
    if ((await call<SyncStatus>({ type: 'syncStatus' })).state !== 'syncing') return void refresh();
  }
}

function emailRecoveryGroup(s: EmailRecoveryStatus | null, refresh: () => unknown) {
  const msg = msgBox();
  const caption = h('p', { class: 'ui-caption' }, 'Email recovery');
  if (!s) return h('div', { class: 'ui-group' }, caption, h('p', { class: 'ui-muted' }, "Couldn't check its status just now. Try again later."));
  if (!s.available) return h('div', { class: 'ui-group' }, caption, h('p', { class: 'ui-muted' }, "Sync isn't available in this build."));
  if (s.waitingForCode) {
    const code = input({ placeholder: 'ABCD-EFGH-…' });
    const go = button('Confirm', () => guarded(msg, [go], async () => {
      await call({ type: 'emailRecovery', action: 'confirm', code: code.value });
      await refresh();
    }), 'ui-btn--primary');
    return h('div', { class: 'ui-group' }, caption, h('p', {}, 'Check your email for the code and type it here to turn on email recovery.'), label('Code from the email', code), msg, go);
  }
  if (s.enrolled) {
    const off = button('Turn off', () => guarded(msg, [off], async () => {
      await call({ type: 'emailRecovery', action: 'off' });
      await refresh();
    }), 'ui-btn--danger');
    return h('div', { class: 'ui-group' }, caption,
      h('p', {}, 'Recovery by email is on.'),
      h('p', { class: 'ui-muted' }, 'Anyone who controls that inbox could start a recovery of your vault. You get 24 hours to cancel it by email before it goes through.'),
      off, msg);
  }
  const email = input({ type: 'email', placeholder: 'you@example.com' });
  const pw = input({ type: 'password', autocomplete: 'current-password' });
  const go = button('Turn on', () => guarded(msg, [go], async () => {
    await call({ type: 'emailRecovery', action: 'enrol', email: email.value, password: pw.value });
    await route();
  }), 'ui-btn--primary');
  return h('div', { class: 'ui-group' }, caption,
    s.wasTurnedOff && h('p', {}, 'Recovery by email is off. Turn it on again.'),
    h('p', { class: 'ui-muted' }, "Email recovery lets you get back into your vault by email if you forget your master password. Anyone who controls that inbox could start a recovery of your vault, with 24 hours to cancel it. Turning this on replaces your current recovery key, so you'll need to save the new one."),
    label('Email address', email), label('Master password', pw), msg, go);
}

async function settingsScreen() {
  const s = await call<EmailRecoveryStatus>({ type: 'emailRecovery', action: 'status' }).catch(() => null);
  screen('Settings', vaultScreen, emailRecoveryGroup(s, settingsScreen));
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
  const sync = await call<SyncStatus>({ type: 'syncStatus' });
  const go = button('Unlock', () => guarded(msg, [go], async () => {
    await call({ type: 'unlock', password: pw.value });
    await route();
  }), 'ui-btn--primary');
  pw.addEventListener('keydown', (e) => e.key === 'Enter' && go.click());
  screen('Unlock Strongroom', null,
    pending && h('p', { class: 'ui-muted' }, `After you unlock, you can save the sign-in you just used on ${pending.host}.`),
    label('Master password', pw), msg, go, button('Forgot master password?', resetScreen, 'ui-btn--ghost'),
    sync.available && (sync.state !== 'off' || sync.keyLost) && button('Sign in with your account', () => signInScreen(unlockScreen), 'ui-btn--ghost'),
    sync.available && button('Lost access to your account?', () => lostAccessScreen(unlockScreen), 'ui-btn--ghost'));
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
  const [{ rows, unreadable }, pending, here, sync, emailRecovery] = await Promise.all([
    call<{ rows: Row[]; unreadable: number }>({ type: 'list' }),
    tab ? call<Pending | null>({ type: 'pending', tabId: tab.tabId }) : null,
    tab ? call<{ rows: Row[] }>({ type: 'candidates', page: tab }) : null,
    call<SyncStatus>({ type: 'syncStatus' }),
    call<EmailRecoveryStatus>({ type: 'emailRecovery', action: 'status' }).catch(() => null),
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

  const recoveryBanner = emailRecovery?.pendingRecovery && h('div', { class: 'ui-group card' },
    h('p', {}, emailRecovery.pendingRecovery.releaseAt
      ? `Someone requested email recovery for this vault. It opens at ${new Date(emailRecovery.pendingRecovery.releaseAt).toLocaleString()} unless you cancel it.`
      : 'Someone requested email recovery for this vault. It is waiting to be confirmed by email.'),
    button('Cancel', () => guarded(msg, [], async () => { await call({ type: 'emailRecovery', action: 'cancelRecovery' }); await vaultScreen(); }), 'ui-btn--danger'));

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
    h('div', { class: 'ui-toolbar' }, button('Add', () => editScreen(null), 'ui-btn--primary'), button('Import', openImport), button('Export', exportScreen),
      button('Settings', settingsScreen),
      h('span', { class: 'grow' }), button('Lock', () => guarded(msg, [], async () => { await call({ type: 'lock', manual: true }); await route(); }), 'ui-btn--ghost')),
    recoveryBanner, pendingCard, hereCard, search, list, syncCard(sync, vaultScreen),
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

async function openImport() {
  if (inImportTab()) return importScreen();
  await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html#import') });
  window.close();
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

function exportScreen() {
  const msg = msgBox();
  const pw = input({ type: 'password', autocomplete: 'current-password' });
  const out = h('div', { class: 'stack' });
  const go = button('Export for Chrome', () => guarded(msg, [go], async () => {
    const { csv, rows, leftOut } = await call<{ csv: string; rows: number; leftOut: number }>({ type: 'export', password: pw.value });
    pw.value = '';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    h('a', { href: url, download: 'strongroom-passwords.csv' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    out.replaceChildren(h('div', { class: 'stack' },
      h('p', {}, `Saved ${rows} ${rows === 1 ? 'login' : 'logins'} to strongroom-passwords.csv.`),
      leftOut > 0 && h('p', { class: 'ui-muted' }, `${leftOut} ${leftOut === 1 ? 'login has' : 'logins have'} no website, so ${leftOut === 1 ? 'it was' : 'they were'} left out. Add a website to ${leftOut === 1 ? 'it' : 'them'} to export ${leftOut === 1 ? 'it' : 'them'}.`),
      h('p', { class: 'ui-muted' }, 'Delete the file as soon as Chrome has imported it. It holds your passwords in plain text.'),
      button('Done', vaultScreen, 'ui-btn--primary')));
  }), 'ui-btn--primary');
  pw.addEventListener('keydown', (e) => e.key === 'Enter' && go.click());
  screen('Export for Chrome', vaultScreen,
    h('p', { class: 'ui-muted' }, "This makes a file you can import into Chrome's password manager. The file holds your passwords in plain text, so anyone who gets it can read them. It leaves out cards, notes and logins without a website."),
    label('Master password', pw), msg, go, out);
}

async function main() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  tab = inImportTab() ? null : active?.id !== undefined && active.url ? { tabId: active.id, url: active.url } : null;
  importNext = inImportTab();
  await route();
}

main().catch((e) => root.replaceChildren(h('p', { class: 'ui-meta msg', role: 'alert' }, e instanceof Error ? e.message : String(e))));
