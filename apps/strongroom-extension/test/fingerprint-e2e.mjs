// Runs fingerprint.html in real Chromium from the extension's own origin, against a virtual WebAuthn authenticator (no real sensor).
// It proves the WebAuthn and PRF calls are well-formed and give the same secret every time; Touch ID itself is checked by hand.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? join(homedir(), 'Documents/browser-automation/node_modules/playwright-core/index.mjs'));
const CHROMIUM = process.env.CHROMIUM_PATH ?? join(homedir(), 'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const PKG = fileURLToPath(new URL('..', import.meta.url));
const EXT = mkdtempSync(join(tmpdir(), 'sg-fp-dist-'));
const profile = mkdtempSync(join(tmpdir(), 'sg-fp-e2e-'));
execFileSync(process.execPath, ['build.mjs'], { cwd: PKG, env: { ...process.env, STRONGROOM_SYNC_URL: '', STRONGROOM_OUT: EXT }, stdio: 'pipe' });

const results = [];
const check = (name, cond, extra = '') => {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  ${extra}`}`);
};

const ctx = await chromium.launchPersistentContext(profile, { executablePath: CHROMIUM, headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const page = await ctx.newPage();
  // The window reports to the worker with chrome.runtime.sendMessage; capture that instead, since the worker would refuse a result it did not ask for.
  await page.addInitScript(() => {
    window.__sent = [];
    chrome.runtime.sendMessage = (m) => (window.__sent.push(m), Promise.resolve());
  });
  await page.goto(`chrome-extension://${id}/popup.html`);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const authenticator = (hasPrf) => cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf },
  });
  const answer = async (query) => {
    await page.goto(`chrome-extension://${id}/fingerprint.html?${new URLSearchParams(query)}`);
    await page.waitForFunction(() => window.__sent.length > 0, null, { timeout: 15000 });
    return page.evaluate(() => window.__sent[0]);
  };
  const bytes = (b64) => Buffer.from(b64 ?? '', 'base64');

  const withPrf = await authenticator(true);
  const enrolled = await answer({ mode: 'enroll', req: 'r1' });
  check('enrolling from the extension page succeeds and reports a credential', enrolled.ok && typeof enrolled.credentialId === 'string' && enrolled.req === 'r1', JSON.stringify(enrolled));
  check('enrolling with a PRF authenticator returns a 32-byte secret', bytes(enrolled.prf).length === 32, JSON.stringify(enrolled));
  const verified = await answer({ mode: 'verify', cred: enrolled.credentialId, req: 'r2' });
  check('verifying returns the same secret every time', verified.ok && verified.prf === enrolled.prf, JSON.stringify(verified));
  const unknown = await answer({ mode: 'verify', cred: Buffer.from('not-a-credential').toString('base64'), req: 'r3' });
  check('an unknown credential is refused', unknown.ok === false, JSON.stringify(unknown));
  check('the window says why and offers Close when a check fails', (await page.innerText('body')).includes('Use your master password') || (await page.innerText('body')).includes('not accepted'));

  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: withPrf.authenticatorId });
  await authenticator(false);
  const plain = await answer({ mode: 'enroll', req: 'r4' });
  check('without PRF, enrolling still works and returns no secret (gate-only mode)', plain.ok && !plain.prf && typeof plain.credentialId === 'string', JSON.stringify(plain));
} catch (e) {
  check('the run finished without an exception', false, String(e?.stack ?? e).split('\n').slice(0, 4).join(' | '));
} finally {
  await ctx.close();
  rmSync(profile, { recursive: true, force: true });
  rmSync(EXT, { recursive: true, force: true });
}
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
