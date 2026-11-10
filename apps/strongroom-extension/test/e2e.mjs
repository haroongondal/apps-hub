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
    check('reached from an already-unlocked vault, sign-in offers no Lost access dead end', (await popup.getByRole('button', { name: 'Lost access to your account?' }).count()) === 0);
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

    await popup.getByRole('button', { name: 'Settings' }).click();
    await popup.getByRole('heading', { name: 'Settings' }).waitFor();
    await popup.getByLabel('Email address').fill('me@example.com');
    await popup.getByLabel('Master password').fill(world.password);
    await popup.getByRole('button', { name: 'Turn on' }).click();
    await popup.getByRole('heading', { name: 'Save your recovery key' }).waitFor();
    const newKey = (await popup.locator('.key').innerText()).trim();
    await popup.locator('input').first().fill(newKey.slice(0, 4));
    await popup.getByRole('button', { name: "I've saved it" }).click();
    await popup.getByRole('heading', { name: 'Strongroom', exact: true }).waitFor();
    await popup.getByRole('button', { name: 'Settings' }).click();
    await popup.getByRole('heading', { name: 'Settings' }).waitFor();
    check('the Settings screen discloses that autofill works while locked', (await popup.innerText('body')).includes('Anyone who can use this browser profile can use this vault'));
    const mailCode = /code is ([A-Z2-7-]+)\./.exec(world.mail.sent.at(-1)?.text ?? '')?.[1];
    check('enrol asks for the emailed code', (await popup.innerText('body')).includes('Check your email for the code') && !!mailCode, mailCode);

    // Mistyped email, or the code never arrives: the waiting-for-code screen must offer a way out, not a dead end.
    await popup.getByRole('button', { name: 'Turn off' }).click();
    await popup.getByLabel('Email address').waitFor();
    check('Turn off from the waiting-for-code screen returns to the pre-enrolment form', (await popup.getByRole('button', { name: 'Turn on' }).count()) === 1);
    await popup.getByLabel('Email address').fill('me@example.com');
    await popup.getByLabel('Master password').fill(world.password);
    await popup.getByRole('button', { name: 'Turn on' }).click();
    await popup.getByRole('heading', { name: 'Save your recovery key' }).waitFor();
    const key2 = (await popup.locator('.key').innerText()).trim();
    await popup.locator('input').first().fill(key2.slice(0, 4));
    await popup.getByRole('button', { name: "I've saved it" }).click();
    await popup.getByRole('heading', { name: 'Strongroom', exact: true }).waitFor();
    await popup.getByRole('button', { name: 'Settings' }).click();
    await popup.getByRole('heading', { name: 'Settings' }).waitFor();
    const mailCode2 = /code is ([A-Z2-7-]+)\./.exec(world.mail.sent.at(-1)?.text ?? '')?.[1];
    await popup.getByLabel('Code from the email').fill(mailCode2);
    await popup.getByRole('button', { name: 'Confirm' }).click();
    await popup.getByText('Recovery by email is on.').waitFor();
    check('enrol, code typed, status enrolled', true);
    await popup.getByRole('button', { name: 'Back' }).click();
    await popup.getByRole('heading', { name: 'Strongroom', exact: true }).waitFor();

    // A transport failure in the email-recovery status check must degrade gracefully, not take down the whole popup.
    world.online = false;
    await popup.reload();
    await popup.getByRole('heading', { name: 'Strongroom', exact: true }).waitFor();
    check('vaultScreen still renders its logins when the email-recovery status check is offline', (await popup.locator('.row').count()) > 0, await popup.innerText('body'));
    await popup.getByRole('button', { name: 'Settings' }).click();
    await popup.getByRole('heading', { name: 'Settings' }).waitFor();
    check('settingsScreen still renders when the email-recovery status check is offline', (await popup.innerText('body')).includes("Couldn't check its status"), await popup.innerText('body'));
    await popup.getByRole('button', { name: 'Back' }).click();
    await popup.getByRole('heading', { name: 'Strongroom', exact: true }).waitFor();
    world.online = true;

    // N2: a hung email-recovery status check (the Worker never answers) must not block the unlock screen's password field,
    // the one thing it must always do instantly. Non-manual lock keeps the device-held token, so the status call is attempted.
    await send({ type: 'lock' });
    let releaseGate = () => {};
    world.gate = new Promise((resolve) => { releaseGate = resolve; });
    try {
      await popup.reload();
      const reloadedAt = Date.now();
      await popup.getByLabel('Master password', { exact: true }).waitFor({ timeout: 1000 });
      check('the unlock screen shows the password field promptly while the email-recovery status check hangs', Date.now() - reloadedAt < 1000);
    } catch (e) {
      check('the unlock screen shows the password field promptly while the email-recovery status check hangs', false, String(e));
    } finally {
      releaseGate();
      world.gate = undefined;
    }
    await popup.getByLabel('Master password', { exact: true }).fill(world.password);
    await popup.getByRole('button', { name: 'Unlock', exact: true }).click();
    await popup.getByRole('heading', { name: 'Strongroom', exact: true }).waitFor();

    const session = await sw.evaluate(() => chrome.storage.session.get('loginToken'));
    check('the login token is in session storage while unlocked', session.loginToken === b64(world.tokens.loginToken));
    const alarm = await sw.evaluate(async () => (await chrome.alarms.getAll()).find((a) => a.name === 'sync'));
    check('a five-minute sync alarm is set while unlocked', alarm?.periodInMinutes === 5, JSON.stringify(alarm));

    const dump = await stored();
    const secrets = [world.accountKeyText, world.accountKeyText.replaceAll('-', ''), world.tokens.loginToken, world.tokens.readToken, recoveryLoginToken(world.recoveryKey)]
      .flatMap((s) => (typeof s === 'string' ? [s, b64(new TextEncoder().encode(s))] : [b64(s), Buffer.from(s).toString('hex'), Buffer.from(s).toString('base64url')]));
    check('storageLocalHasNoReadableTokenOrAccountKeyText', secrets.every((s) => !dump.includes(s)), secrets.filter((s) => dump.includes(s)).length + ' found');
    // Stale since Task 6/7 sealed the account key (apps-hub strongroom-extension-security plan): the plain `accountKey` entry is gone, replaced by `accountKeySealed`.
    check('the account key is kept sealed beside the header, not as plain bytes', JSON.parse(dump).accountKey === undefined && typeof JSON.parse(dump).accountKeySealed === 'string');

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
    check('the unlock screen discloses that autofill works while locked', (await popup.innerText('body')).includes('Anyone who can use this browser profile can use this vault'));
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

    // A separate profile with no local vault: the device that lost access, walked through the real Worker world with a backdated release time instead of a 24-hour wait.
    // ctx (the owner's signed-in popup) stays open so it can cancel the lost-access request below, same as a real second device would.
    const lostProfile = mkdtempSync(join(tmpdir(), 'sg-lost-e2e-'));
    const lost = await launchWith(syncDist, lostProfile);
    const lostPopup = await lost.ctx.newPage();
    lostPopup.on('pageerror', (e) => errors.push(`lost popup: ${e.message}`));
    await lostPopup.goto(`chrome-extension://${lost.id}/popup.html`);
    await lostPopup.getByRole('heading', { name: 'Create your vault' }).waitFor();
    await lostPopup.getByRole('button', { name: 'Use my Strongroom account instead' }).click();
    await lostPopup.getByRole('heading', { name: 'Sign in to sync' }).waitFor();

    await lostPopup.getByRole('button', { name: 'Lost access to your account?' }).click();
    await lostPopup.getByRole('button', { name: 'Request access by email' }).click();
    await lostPopup.getByText('Check your email and open the confirm link').waitFor();
    check('the waiting screen offers a way to start over before confirmation', (await lostPopup.getByRole('button', { name: 'Start a new request' }).count()) === 1);

    // A single click only arms the dangerous action; declining it (navigating away without the second click) must never have fired the network call or touched the stored claim.
    await lostPopup.getByRole('button', { name: 'Start a new request' }).click();
    await lostPopup.getByRole('button', { name: 'Yes, start a new request' }).waitFor();
    const claimBeforeDecline = (await lost.sw.evaluate(() => chrome.storage.local.get('lostClaim'))).lostClaim;
    await lostPopup.getByRole('button', { name: 'Back' }).click();
    await lostPopup.getByRole('heading', { name: 'Create your vault' }).waitFor();
    const claimAfterDecline = (await lost.sw.evaluate(() => chrome.storage.local.get('lostClaim'))).lostClaim;
    check('declining the start-over confirmation leaves the original claim untouched', !!claimBeforeDecline && claimAfterDecline === claimBeforeDecline);
    await lostPopup.getByRole('button', { name: 'Use my Strongroom account instead' }).click();
    await lostPopup.getByRole('button', { name: 'Lost access to your account?' }).click();
    await lostPopup.getByText('Check your email and open the confirm link').waitFor();

    // A claim is already stored, so this Check again does reach the network: a transport failure here must show a distinct retry state, never fall into the request-button state that would overwrite the real claim.
    world.online = false;
    await lostPopup.getByRole('button', { name: 'Check again' }).click();
    await lostPopup.getByText("Couldn't check its status just now").waitFor();
    check('a failed check shows a retry state, never the request button', (await lostPopup.getByRole('button', { name: 'Request access by email' }).count()) === 0);
    world.online = true;
    await lostPopup.getByRole('button', { name: 'Try again' }).click();
    await lostPopup.getByText('Check your email and open the confirm link').waitFor();

    await send({ type: 'emailRecovery', action: 'cancelRecovery' });
    await lostPopup.getByRole('button', { name: 'Check again' }).click();
    await lostPopup.getByText('Check your email and open the confirm link').waitFor();
    const mailsBeforeRestart = world.mail.sent.length;
    await lostPopup.getByRole('button', { name: 'Start a new request' }).click();
    await lostPopup.getByRole('button', { name: 'Yes, start a new request' }).click();
    // The waiting-screen's text and the unarmed button's label are identical before and after a restart; only the mail count proves the new claim actually reached the server.
    await until('the restarted request to mail its own confirm link', async () => world.mail.sent.length > mailsBeforeRestart);

    // A literal double-click must not complete the two-step confirm in one gesture: the second press of the pair should land on a still-disabled button.
    const mailsBeforeDblclick = world.mail.sent.length;
    const claimBeforeDblclick = (await lost.sw.evaluate(() => chrome.storage.local.get('lostClaim'))).lostClaim;
    await lostPopup.getByRole('button', { name: 'Start a new request' }).dblclick();
    await lostPopup.getByRole('button', { name: 'Yes, start a new request' }).waitFor();
    const claimAfterDblclick = (await lost.sw.evaluate(() => chrome.storage.local.get('lostClaim'))).lostClaim;
    check('a double-click does not fire the destructive request in one gesture',
      world.mail.sent.length === mailsBeforeDblclick && claimAfterDblclick === claimBeforeDblclick,
      JSON.stringify({ mailsBefore: mailsBeforeDblclick, mailsAfter: world.mail.sent.length, claimBeforeDblclick, claimAfterDblclick }));

    // Confirmed elsewhere while this popup still shows the armed, unconfirmed screen: the service's own truth check must refuse the stale click, not just whatever the UI happens to render.
    await lostPopup.waitForTimeout(700);
    await fetch(new URL('/v1/lost/confirm', harness.url), {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `t=${/t=([^&\s]+)/.exec(world.mail.sent.at(-1).text)[1]}`,
    });
    await lostPopup.getByRole('button', { name: 'Yes, start a new request' }).click();
    await lostPopup.locator('.msg:not(:empty)').waitFor();
    const msgSeen = await lostPopup.locator('.msg').innerText();
    check('a stale screen cannot replace a claim the server now calls confirmed',
      (await lost.sw.evaluate(() => chrome.storage.local.get('lostClaim'))).lostClaim === claimBeforeDblclick, msgSeen);

    await lostPopup.getByRole('button', { name: 'Check again' }).click();
    await lostPopup.getByText(/lets you back in at/).waitFor();
    check('a confirmed, counting-down claim offers no way to replace it', (await lostPopup.getByRole('button', { name: 'Start a new request' }).count()) === 0);
    world.sqlite.exec(`UPDATE lost_request SET release_at = ${Date.now() - 1000}`);
    await lostPopup.getByRole('button', { name: 'Check again' }).click();
    await lostPopup.getByLabel('Code from the email').waitFor();
    await lostPopup.getByLabel('Code from the email').fill(mailCode2);
    await lostPopup.getByLabel('New master password (at least 12 characters)').fill('a lost access password');
    await lostPopup.getByLabel('Type it again').fill('a lost access password');
    await lostPopup.getByRole('button', { name: 'Open and sign in' }).click();
    await lostPopup.getByRole('heading', { name: 'Strongroom', exact: true }).waitFor();
    check('lost access recovers even after the first request was cancelled, by starting a new one', (await lostPopup.locator('.row').count()) > 0, await lostPopup.innerText('body'));
    await lost.ctx.close();
    rmSync(lostProfile, { recursive: true, force: true });
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

  // The auto-lock alarm sends a plain `lock` (no manual flag), simulated here the same way the alarm handler does it: fills must keep working from the device-held keys.
  await send({ type: 'lock' });
  const afterAlarm = await send({ type: 'status' });
  check('status says locked once the auto-lock alarm fires', afterAlarm.ok && afterAlarm.data.state === 'locked', JSON.stringify(afterAlarm));
  await page.goto(GOOD);
  await page.locator('#u').click();
  await page.waitForTimeout(1500);
  check('fill still works after the popup session auto-locks', await menuShown(page));
  const autoBox = await page.locator('#u').boundingBox();
  await page.mouse.click(autoBox.x + 30, autoBox.y + autoBox.height + 18);
  await page.waitForTimeout(800);
  check('the fill after auto-lock restores the saved credentials', (await page.inputValue('#u')) === 'tester' && (await page.inputValue('#p')) === 'p4ssw0rd-local');
  await send({ type: 'unlock', password: MASTER }); // restore the unlocked session for the checks below

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

  // Chrome closes the toolbar popup when the file picker opens, so Import must run in its own tab.
  const opened = ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null);
  await popup.getByRole('button', { name: 'Import' }).click();
  const tabPage = await opened;
  const inTab = !!tabPage && tabPage.url().endsWith('#import');
  check('Import opens in its own tab and imports', inTab, tabPage ? tabPage.url() : 'no new page');
  if (!inTab) throw new Error('Import did not open a tab');
  tabPage.on('pageerror', (e) => errors.push(`import tab: ${e.message}`));
  await tabPage.locator('input[type=file]').waitFor();
  await popup.close();
  popup = tabPage;
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

  await popup.getByRole('button', { name: 'Export', exact: true }).click();
  await popup.getByRole('heading', { name: 'Export for Chrome' }).waitFor();
  await popup.locator('input[type=password]').fill('the wrong password');
  await popup.getByRole('button', { name: 'Export for Chrome' }).click();
  await popup.locator('.msg:not(:empty)').waitFor();
  check('Export refuses a wrong master password', (await popup.locator('.msg').innerText()).includes("isn't right"));
  await popup.locator('input[type=password]').fill(MASTER);
  const [download] = await Promise.all([popup.waitForEvent('download'), popup.getByRole('button', { name: 'Export for Chrome' }).click()]);
  const exportPath = join(profile, 'export.csv');
  await download.saveAs(exportPath);
  const exported = readFileSync(exportPath, 'utf8');
  check('Export downloads strongroom-passwords.csv with the five Chrome columns and the logins', download.suggestedFilename() === 'strongroom-passwords.csv' && exported.startsWith('name,url,username,password,note\r\n') && exported.includes('p4ssw0rd-local') && exported.includes('newuser@example.com'), exported.slice(0, 200));
  await popup.getByText('to strongroom-passwords.csv').waitFor();
  check('Export tells the owner to delete the file and counts logins left out', (await popup.getByText('Delete the file as soon as Chrome has imported it').isVisible()) && (await popup.innerText('body')).includes('no website'));
  await popup.getByRole('button', { name: 'Done' }).click();
  await popup.getByRole('heading', { name: 'Strongroom', exact: true }).waitFor();

  // A plain restart (no manual Lock before it) must not block a fill: the popup's session is gone, but the device-held keys answer it.
  await ctx.close();
  ({ ctx, sw, id } = await launch());
  popup = await openPopup();
  await popup.getByRole('heading', { name: 'Unlock Strongroom' }).waitFor();
  check('after a plain restart the popup still shows locked', true);
  const restartedPage = await ctx.newPage();
  restartedPage.on('pageerror', (e) => errors.push(`restarted page: ${e.message}`));
  await restartedPage.goto(GOOD);
  await restartedPage.locator('#u').click();
  await restartedPage.waitForTimeout(1500);
  check('fill still works after a plain restart (real suggestions, not a locked prompt)', await menuShown(restartedPage));
  const restartedBox = await restartedPage.locator('#u').boundingBox();
  await restartedPage.mouse.click(restartedBox.x + 30, restartedBox.y + restartedBox.height + 18);
  await restartedPage.waitForTimeout(800);
  check('a plain restart does not prevent a fill', (await restartedPage.inputValue('#u')) === 'tester' && (await restartedPage.inputValue('#p')) === 'p4ssw0rd-local');
  await restartedPage.close();

  // Only the popup's manual Lock button clears the device-held keys; it, and only it, should block a fill after the next restart.
  await popup.locator('input[type=password]').fill(MASTER);
  await popup.getByRole('button', { name: 'Unlock', exact: true }).click();
  await popup.getByRole('heading', { name: 'Strongroom', exact: true }).waitFor();
  await popup.getByRole('button', { name: 'Lock' }).click();
  await popup.getByRole('heading', { name: 'Unlock Strongroom' }).waitFor();
  await ctx.close();
  ({ ctx, sw, id } = await launch());
  popup = await openPopup();
  await popup.getByRole('heading', { name: 'Unlock Strongroom' }).waitFor();
  const lockedPage = await ctx.newPage();
  lockedPage.on('pageerror', (e) => errors.push(`locked page: ${e.message}`));
  await lockedPage.goto(GOOD);
  await lockedPage.locator('#u').click();
  await lockedPage.waitForTimeout(1500);
  check('fill asks to unlock after the manual Lock button and a browser restart', await menuShown(lockedPage));
  const lockedBox = await lockedPage.locator('#u').boundingBox();
  await lockedPage.mouse.click(lockedBox.x + 30, lockedBox.y + lockedBox.height + 18);
  await lockedPage.waitForTimeout(800);
  check('clicking the locked prompt does not fill, unlike the plain-restart case above', (await lockedPage.inputValue('#u')) === '' && (await lockedPage.inputValue('#p')) === '');
  await lockedPage.close();

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
