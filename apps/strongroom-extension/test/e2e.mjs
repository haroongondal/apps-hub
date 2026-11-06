// Opens real Chromium with the extension, built here without a sync server (the sync suite makes its own build). Not part of `pnpm test`.
// Needs playwright-core and a Chromium: set PLAYWRIGHT_CORE and CHROMIUM_PATH if yours live elsewhere; screenshots go to SHOTS.
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recoveryLoginToken } from 'strongroom-core';
import { newWorld, serveHttp } from '../src/__tests__/sync-world.ts';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? join(homedir(), 'Documents/browser-automation/node_modules/playwright-core/index.mjs'));
const CHROMIUM = process.env.CHROMIUM_PATH ?? join(homedir(), 'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const SCRATCH = process.env.SHOTS ?? tmpdir();
const PKG = fileURLToPath(new URL('..', import.meta.url));
const EXT = mkdtempSync(join(tmpdir(), 'sg-dist-'));
execFileSync(process.execPath, ['build.mjs'], { cwd: PKG, env: { ...process.env, STRONGROOM_SYNC_URL: '', STRONGROOM_OUT: EXT }, stdio: 'pipe' });
const CSV = fileURLToPath(new URL('../../strongroom/modules/strongroom-vault/android/src/test/resources/google-export-redacted.csv', import.meta.url));
const MASTER = 'correct horse battery staple';

const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  ${extra}`}`);
};

const page_html = `<!doctype html><title>Sign in</title><body style="font:16px sans-serif;padding:40px">
<form id="f" action="/welcome" method="post" novalidate><p><label>Email <input id="u" name="email" type="email"></label></p>
<p><label>Password <input id="p" name="pw" type="password"></label></p><button id="go" type="submit">Sign in</button></form></body>`;
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(req.url.startsWith('/login') ? page_html : '<h1>Welcome</h1>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const GOOD = `http://localhost:${PORT}/login.html`;
const OTHER = `http://127.0.0.1:${PORT}/login.html`;

const profile = mkdtempSync(join(tmpdir(), 'sg-e2e-'));
const launchWith = async (ext, dir) => {
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: CHROMIUM, headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  return { ctx, sw, id: new URL(sw.url()).host };
};
const launch = () => launchWith(EXT, profile);

const menuShown = (page) => page.evaluate(() => document.documentElement.lastElementChild?.style?.zIndex === '2147483647');
const errors = [];

const until = async (what, fn, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${what}`);
};
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

// A second build points the extension at the real Worker over plain HTTP on 127.0.0.1; the phone is a strongroom-core device on the same database.
async function syncSuite() {
  const world = await newWorld();
  await world.phone.add('Phone mail');
  await world.phone.sync();
  const harness = await serveHttp(world);
  const syncDist = mkdtempSync(join(tmpdir(), 'sg-sync-dist-'));
  const syncProfile = mkdtempSync(join(tmpdir(), 'sg-sync-e2e-'));
  try {
    execFileSync(process.execPath, ['build.mjs'], { cwd: PKG, env: { ...process.env, STRONGROOM_SYNC_URL: harness.url, STRONGROOM_OUT: syncDist }, stdio: 'pipe' });
    const manifest = JSON.parse(readFileSync(join(syncDist, 'manifest.json'), 'utf8'));
    check('the sync build asks for the sync origin and no other permission', JSON.stringify(manifest.host_permissions) === JSON.stringify([`${harness.url}/*`]) && manifest.permissions.join() === 'storage,alarms,activeTab', JSON.stringify(manifest));
    check('a build without a server asks for no host permission', !('host_permissions' in JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'))));

    let { ctx, sw, id } = await launchWith(syncDist, syncProfile);
    const openPopup = async () => {
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errors.push(`sync popup: ${e.message}`));
      await p.goto(`chrome-extension://${id}/popup.html`);
      return p;
    };
    let popup = await openPopup();
    const send = (msg) => popup.evaluate((m) => chrome.runtime.sendMessage(m), msg);
    const names = async () => (await send({ type: 'list' })).data.rows.map((r) => r.name).sort();
    const stored = () => sw.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
    const THROWAWAY = 'a throwaway master password';

    await popup.getByRole('heading', { name: 'Create your vault' }).waitFor();
    const setupText = await popup.innerText('body');
    check('the sync build offers sign-in on the setup screen and says only encrypted data goes to the vault server', (await popup.getByRole('button', { name: 'Use my Strongroom account instead' }).count()) === 1 && setupText.includes('only the encrypted data goes to your own vault server'), setupText);
    await send({ type: 'setup', password: THROWAWAY });
    const recovery = (await send({ type: 'status' })).data.recoveryKey;
    await send({ type: 'confirmRecovery', group: recovery.slice(0, 4) });
    await send({ type: 'save', id: null, login: { name: 'Throwaway', username: 'x', password: 'y', websites: 'https://throwaway.example', note: '' } });
    await popup.reload();
    await popup.getByRole('heading', { name: 'Strongroom', exact: true }).waitFor();
    check('the Sync card says sync is off before sign-in', (await popup.locator('#sync').innerText()).includes('Sync is off'));

    await popup.getByRole('button', { name: 'Sign in to sync' }).click();
    await popup.getByRole('heading', { name: 'Sign in to sync' }).waitFor();
    await popup.getByLabel('Master password', { exact: true }).fill('not the password');
    await popup.getByLabel('Account key', { exact: true }).fill(world.accountKeyText);
    await popup.getByRole('button', { name: 'Sign in', exact: true }).click();
    await popup.locator('.msg:not(:empty)').waitFor();
    check('a refused sign-in says password or account key', (await popup.locator('.msg').innerText()).includes('password or account key'));
    check('a refused sign-in leaves the old vault as it was', (await names()).join() === 'Throwaway');

    await popup.getByLabel('Master password', { exact: true }).fill(world.password);
    await popup.getByRole('button', { name: 'Sign in', exact: true }).click();
    await popup.getByRole('heading', { name: 'Replace this vault?' }).waitFor();
    check('the replace confirmation names the entry count', (await popup.innerText('body')).includes('holds 1 saved item'));
    check('nothing is replaced before the owner confirms', (await names()).join() === 'Throwaway');
    await popup.screenshot({ path: `${SCRATCH}/6-replace.png` });
    await popup.getByRole('button', { name: 'Replace and sign in' }).click();
    await popup.getByRole('heading', { name: 'Strongroom', exact: true }).waitFor();
    check('signsInAndSeesThePhonesLogin', (await names()).join() === 'Phone mail' && (await popup.locator('.row').count()) === 1, (await names()).join());
    check('the Sync card shows the last sync after sign-in', /Synced at \d/.test(await popup.locator('#sync').innerText()), await popup.locator('#sync').innerText());
    await popup.screenshot({ path: `${SCRATCH}/7-synced.png` });

    await send({ type: 'save', id: null, login: { name: 'From Chrome', username: 'c', password: 'p', websites: '', note: '' } });
    const reached = await until('the save to reach the phone', async () => ((await world.phone.sync(), (await world.phone.names()).includes('From Chrome'))));
    await world.phone.add('From phone');
    await world.phone.sync();
    const synced = await send({ type: 'syncNow' });
    check('editOnOneSideAppearsOnTheOther', reached && synced.ok && (await names()).join() === 'From Chrome,From phone,Phone mail', JSON.stringify([synced, await names()]));

    const session = await sw.evaluate(() => chrome.storage.session.get('loginToken'));
    check('the login token is in session storage while unlocked', session.loginToken === b64(world.tokens.loginToken));
    const alarm = await sw.evaluate(async () => (await chrome.alarms.getAll()).find((a) => a.name === 'sync'));
    check('a five-minute sync alarm is set while unlocked', alarm?.periodInMinutes === 5, JSON.stringify(alarm));

    const dump = await stored();
    const secrets = [world.accountKeyText, world.accountKeyText.replaceAll('-', ''), world.tokens.loginToken, world.tokens.readToken, recoveryLoginToken(world.recoveryKey)]
      .flatMap((s) => (typeof s === 'string' ? [s, b64(new TextEncoder().encode(s))] : [b64(s), Buffer.from(s).toString('hex'), Buffer.from(s).toString('base64url')]));
    check('storageLocalHasNoReadableTokenOrAccountKeyText', secrets.every((s) => !dump.includes(s)), secrets.filter((s) => dump.includes(s)).length + ' found');
    check('the account key is kept beside the header as raw bytes, nothing more', JSON.parse(dump).accountKey === b64(world.accountKey));

    // The content script runs on every web page, so storage.local (the account key) must be closed to it: setAccessLevel(TRUSTED_CONTEXTS).
    const site = await ctx.newPage();
    const cdp = await ctx.newCDPSession(site);
    const contexts = [];
    cdp.on('Runtime.executionContextCreated', (e) => contexts.push(e.context));
    await cdp.send('Runtime.enable');
    await site.goto(GOOD);
    const contentWorld = await until('the content script to start', async () => contexts.findLast((c) => c.origin === `chrome-extension://${id}`));
    const inContent = async (expression) => (await cdp.send('Runtime.evaluate', { expression, contextId: contentWorld.id, awaitPromise: true, returnByValue: true })).result.value;
    const isContentScript = await inContent(`typeof chrome.runtime?.sendMessage === 'function'`);
    const reach = await inContent(`(async () => { try { return 'read: ' + Object.keys(await chrome.storage.local.get(null)).join(); } catch (e) { return 'refused: ' + e.message; } })()`);
    check('a content script cannot read storage.local, where the account key is kept', isContentScript && String(reach).startsWith('refused'), `${isContentScript} ${reach}`);
    await site.close();

    await popup.getByRole('button', { name: 'Lock' }).click();
    await popup.getByRole('heading', { name: 'Unlock Strongroom' }).waitFor();
    check('a signed-in extension offers sign-in on the unlock screen', (await popup.getByRole('button', { name: 'Sign in with your account' }).count()) === 1);
    await popup.getByRole('button', { name: 'Sign in with your account' }).click();
    await popup.getByRole('heading', { name: 'Sign in to sync' }).waitFor();
    await popup.getByRole('button', { name: 'Back' }).click();
    await popup.getByRole('heading', { name: 'Unlock Strongroom' }).waitFor();
    check('lock clears the login token', (await sw.evaluate(() => chrome.storage.session.get('loginToken'))).loginToken === undefined);
    check('lock clears the sync alarm', (await sw.evaluate(async () => (await chrome.alarms.getAll()).some((a) => a.name === 'sync'))) === false);

    await ctx.close();
    ({ ctx, sw, id } = await launchWith(syncDist, syncProfile));
    popup = await openPopup();
    await popup.getByRole('heading', { name: 'Unlock Strongroom' }).waitFor();
    const status = (await send({ type: 'syncStatus' })).data;
    check('restartKeepsSyncStateAndStaysLocked', status.state === 'idle' && status.lastSyncAt > 0 && status.available, JSON.stringify(status));
    await world.phone.add('After restart');
    await world.phone.sync();
    await popup.locator('input[type=password]').fill(world.password);
    await popup.getByRole('button', { name: 'Unlock', exact: true }).click();
    await popup.getByRole('heading', { name: 'Strongroom', exact: true }).waitFor();
    await until('the unlock sync to bring the phone login', async () => (await names()).includes('After restart'));
    check('unlocking after a restart signs in again by itself and syncs', (await names()).join() === 'After restart,From Chrome,From phone,Phone mail', (await names()).join());
    await ctx.close();
  } finally {
    await harness.close();
    rmSync(syncDist, { recursive: true, force: true });
    rmSync(syncProfile, { recursive: true, force: true });
  }
}

try {
  let { ctx, sw, id } = await launch();
  const openPopup = async () => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`popup: ${e.message}`));
    await p.goto(`chrome-extension://${id}/popup.html`);
    return p;
  };

  let popup = await openPopup();
  await popup.getByRole('heading', { name: 'Create your vault' }).waitFor();
  const defaultSetup = await popup.innerText('body');
  check('a build without a server offers no account sign-in on the setup screen and makes no promise about the server', (await popup.getByRole('button', { name: 'Use my Strongroom account instead' }).count()) === 0 && defaultSetup.includes('they stay here') && !defaultSetup.includes('Nothing leaves it'), defaultSetup);
  await popup.locator('input[type=password]').nth(0).fill('short');
  await popup.locator('input[type=password]').nth(1).fill('short');
  await popup.getByRole('button', { name: 'Create vault' }).click();
  await popup.locator('.msg:not(:empty)').waitFor();
  check('a short master password is refused with a message', (await popup.locator('.msg').innerText()).includes('12 characters'));
  await popup.locator('input[type=password]').nth(0).fill(MASTER);
  await popup.locator('input[type=password]').nth(1).fill(MASTER);
  await popup.getByRole('button', { name: 'Create vault' }).click();
  await popup.getByRole('heading', { name: 'Save your recovery key' }).waitFor();
  const key = (await popup.locator('.key').innerText()).trim();
  check('the recovery key is shown as eight groups', /^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/.test(key), key);
  await popup.screenshot({ path: `${SCRATCH}/1-recovery.png` });
  await popup.locator('input').first().fill('ZZZZ');
  await popup.getByRole('button', { name: "I've saved it" }).click();
  await popup.locator('.msg:not(:empty)').waitFor();
  check('a wrong first group is refused', (await popup.locator('.msg').innerText()).includes("doesn't match"));
  await popup.locator('input').first().fill(key.slice(0, 4));
  await popup.getByRole('button', { name: "I've saved it" }).click();
  await popup.getByRole('heading', { name: 'Strongroom', exact: true }).waitFor();
  check('after setup the vault is open and empty', await popup.getByText('No logins yet').isVisible());

  await popup.getByRole('button', { name: 'Add', exact: true }).click();
  const fields = popup.locator('input.ui-input, textarea.ui-input');
  await fields.nth(0).fill('Local test');
  await fields.nth(1).fill('tester');
  await fields.nth(2).fill('p4ssw0rd-local');
  await popup.locator('textarea').first().fill(`http://localhost:${PORT}`);
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await popup.getByRole('heading', { name: 'Local test' }).waitFor();
  check('the saved login shows its username and hides the password', (await popup.innerText('body')).includes('tester') && !(await popup.innerText('body')).includes('p4ssw0rd-local'));
  await popup.getByRole('button', { name: 'Show' }).click();
  check('Show reveals the password', (await popup.innerText('body')).includes('p4ssw0rd-local'));
  await popup.screenshot({ path: `${SCRATCH}/2-detail.png` });

  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`page: ${e.message}`));
  await page.goto(GOOD);
  await page.locator('#u').click();
  await page.waitForTimeout(1500);
  check('the menu opens on a matching site', await menuShown(page));
  await page.screenshot({ path: `${SCRATCH}/3-menu.png` });
  const box = await page.locator('#u').boundingBox();
  await page.mouse.click(box.x + 30, box.y + box.height + 18);
  await page.waitForTimeout(800);
  check('clicking the suggestion fills the username', (await page.inputValue('#u')) === 'tester', await page.inputValue('#u'));
  check('clicking the suggestion fills the password', (await page.inputValue('#p')) === 'p4ssw0rd-local');
  check('the menu closes after filling', !(await menuShown(page)));

  await page.goto(GOOD);
  await page.locator('#u').click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.documentElement.lastElementChild.style.opacity = '0'; });
  await page.waitForTimeout(500);
  const hiddenBox = await page.locator('#u').boundingBox();
  await page.mouse.click(hiddenBox.x + 30, hiddenBox.y + hiddenBox.height + 18);
  await page.waitForTimeout(800);
  check('a page that hides the menu cannot get it clicked into filling', (await page.inputValue('#u')) === '' && (await page.inputValue('#p')) === '');

  const other = await ctx.newPage();
  await other.goto(OTHER);
  await other.locator('#u').click();
  await other.waitForTimeout(1500);
  check('no menu on a host the login is not saved for', !(await menuShown(other)));

  await other.locator('#u').fill('newuser@example.com');
  await other.locator('#p').fill('brand-new-pass-1');
  await Promise.all([other.waitForURL('**/welcome'), other.locator('#go').click()]);
  await other.waitForTimeout(800);
  const pendingKeys = await sw.evaluate(async () => Object.keys(JSON.parse((await chrome.storage.session.get('pending')).pending ?? '{}')));
  check('the submitted sign-in is waiting in session memory', pendingKeys.length === 1, JSON.stringify(pendingKeys));
  const tabId = Number(pendingKeys[0]);
  let badge = '';
  for (let i = 0; i < 25 && badge !== '1'; i++) {
    badge = await sw.evaluate((t) => chrome.action.getBadgeText({ tabId: t }), tabId);
    if (badge !== '1') await other.waitForTimeout(200);
  }
  check('the toolbar badge flags it', badge === '1', badge);
  const send = (msg) => popup.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  const pending = await send({ type: 'pending', tabId });
  check('the popup is told to offer a new login for that host', pending.ok && pending.data.intent === 'new' && pending.data.host === `127.0.0.1:${PORT}` && !JSON.stringify(pending).includes('brand-new-pass-1'), JSON.stringify(pending));
  await send({ type: 'resolvePending', tabId, action: 'save' });
  const list = await send({ type: 'list' });
  check('saving adds it to the vault', list.ok && list.data.rows.some((r) => r.username === 'newuser@example.com'), JSON.stringify(list.data?.rows?.map((r) => r.name)));

  const localId = list.data.rows.find((r) => r.name === 'Local test').id;
  await other.goto(OTHER);
  await other.waitForTimeout(500);
  await popup.evaluate(([t, i]) => chrome.tabs.sendMessage(t, { type: 'fillForm', id: i }), [tabId, localId]);
  await other.waitForTimeout(800);
  check('the popup cannot make a page fill a login saved for another site', (await other.inputValue('#u')) === '' && (await other.inputValue('#p')) === '');
  await page.goto(GOOD);
  await page.locator('#u').fill('tester');
  await page.locator('#p').fill('rotated-pass-2');
  await Promise.all([page.waitForURL('**/welcome'), page.locator('#go').click()]);
  await page.waitForTimeout(800);
  const pendingNow = await sw.evaluate(async () => Object.keys(JSON.parse((await chrome.storage.session.get('pending')).pending ?? '{}')));
  const pageTabId = Number(pendingNow[0]);
  const update = await send({ type: 'pending', tabId: pageTabId });
  check('a changed password for a saved login is offered as an update', pendingNow.length === 1 && update.ok && update.data.intent === 'update' && update.data.name === 'Local test', JSON.stringify(update));
  await send({ type: 'resolvePending', tabId: pageTabId, action: 'dismiss' });
  await page.goto(GOOD);
  await page.waitForTimeout(500);
  await popup.evaluate(([t, i]) => chrome.tabs.sendMessage(t, { type: 'fillForm', id: i }), [pageTabId, localId]);
  await page.waitForTimeout(800);
  check('the popup can fill a page whose site the login is saved for', (await page.inputValue('#u')) === 'tester' && (await page.inputValue('#p')) === 'p4ssw0rd-local');
  const here = await send({ type: 'candidates', page: { url: GOOD, tabId } });
  check('the popup can ask which logins match a tab', here.ok && here.data.rows.map((r) => r.name).join() === 'Local test', JSON.stringify(here));
  const lookalike = await send({ type: 'candidates', page: { url: `http://localhost.evil.test:${PORT}/`, tabId } });
  check('a lookalike host matches nothing', lookalike.ok && lookalike.data.rows.length === 0, JSON.stringify(lookalike));
  const alarms = await sw.evaluate(() => chrome.alarms.getAll());
  const ahead = (alarms.find((a) => a.name === 'auto-lock')?.scheduledTime ?? 0) - Date.now();
  check('the five-minute auto-lock alarm is set while unlocked', ahead > 4 * 60_000 && ahead <= 5 * 60_000 + 5_000, String(ahead));

  const noApi = await page.evaluate(() => typeof chrome === 'undefined' || typeof chrome.runtime?.sendMessage !== 'function');
  check('the web page itself has no way to message the extension', noApi);

  await popup.reload();
  await popup.getByRole('button', { name: 'Lock' }).click();
  await popup.getByRole('heading', { name: 'Unlock Strongroom' }).waitFor();
  check('a build without a server offers no account sign-in on the unlock screen', (await popup.getByRole('button', { name: 'Sign in with your account' }).count()) === 0);
  await page.reload();
  await page.locator('#u').click();
  await page.waitForTimeout(1500);
  check('while locked the page offers only an unlock prompt', await menuShown(page));
  await page.screenshot({ path: `${SCRATCH}/4-locked-menu.png` });
  await popup.locator('input[type=password]').fill('the wrong password');
  await popup.getByRole('button', { name: 'Unlock', exact: true }).click();
  await popup.locator('.msg:not(:empty)').waitFor();
  check('a wrong master password is refused', (await popup.locator('.msg').innerText()).includes("isn't right"));
  await popup.locator('input[type=password]').fill(MASTER);
  await popup.getByRole('button', { name: 'Unlock', exact: true }).click();
  await popup.getByRole('heading', { name: 'Strongroom', exact: true }).waitFor();
  check('the right master password unlocks', true);

  await popup.getByRole('button', { name: 'Import' }).click();
  await popup.locator('input[type=file]').setInputFiles(CSV);
  await popup.getByText('logins found').waitFor();
  const summary = await popup.getByText('logins found').innerText();
  check('the import preview counts match the Android tests', summary === '9 logins found, 1 duplicates merged, 2 need review.', summary);
  await popup.getByRole('button', { name: 'Import 8 logins' }).click();
  await popup.getByText('Imported 8 logins.').waitFor();
  check('the import warns about the plain-text file', await popup.getByText('Delete the exported file now').isVisible());
  await popup.getByRole('button', { name: 'Done' }).click();
  await popup.getByRole('heading', { name: 'Strongroom', exact: true }).waitFor();
  const rows = await popup.locator('.row').count();
  check('the imported logins are listed', rows === 10, String(rows));
  check('flagged duplicates are marked for review', (await popup.getByText('Review', { exact: true }).count()) === 2);
  await popup.screenshot({ path: `${SCRATCH}/5-list.png` });

  await ctx.close();
  ({ ctx, sw, id } = await launch());
  popup = await openPopup();
  await popup.getByRole('heading', { name: 'Unlock Strongroom' }).waitFor();
  check('after a browser restart the vault is locked', true);
  await popup.locator('input[type=password]').fill(MASTER);
  await popup.getByRole('button', { name: 'Unlock', exact: true }).click();
  await popup.getByRole('heading', { name: 'Strongroom', exact: true }).waitFor();
  const after = await popup.locator('.row').count();
  check('the logins survive the restart', after === 10, String(after));
  const onDisk = await sw.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
  check('nothing readable is stored on disk', !onDisk.includes('p4ssw0rd-local') && !onDisk.includes('tester') && !onDisk.includes('brand-new-pass-1') && !onDisk.includes('Local test'));
  await ctx.close();
  await syncSuite();
} catch (e) {
  check('the run finished without an exception', false, String(e?.stack ?? e).split('\n').slice(0, 4).join(' | '));
} finally {
  server.close();
  rmSync(profile, { recursive: true, force: true });
  rmSync(EXT, { recursive: true, force: true });
}

if (errors.length) console.log('page errors:', errors);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
