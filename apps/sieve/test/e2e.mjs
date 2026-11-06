// Real Chromium with the built extension (run `pnpm --filter sieve build` first). Not part of `pnpm test`.
import { setTimeout as sleep } from 'node:timers/promises';
import { check, launch, results, startServers, startWorker, stopWorker } from './harness.mjs';

const RULESETS = ['ads', 'trackers', 'distraction', 'cookies', 'antiadblock'];
const ALLOW_ID = 1_000_000;
const servers = await startServers();
const ADS = `https://localhost:${servers.httpsPort}/ads.html`;
const ADS_IP = `https://127.0.0.1:${servers.httpsPort}/ads.html`;
const errors = [];
const json = (v) => String(JSON.stringify(v)).slice(0, 500);

const visit = async (ctx, url) => {
  servers.hits.length = 0;
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.close();
  return [...servers.hits];
};

// [promise answer, callback answer, PushManager.subscribe outcome]
const askNotifications = async (ctx, url) => {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'load' });
  const out = await page.evaluate(async () => [
    await Notification.requestPermission(),
    await new Promise((r) => Notification.requestPermission(r)),
    await PushManager.prototype.subscribe.call({}).then(() => 'subscribed', (e) => e.name),
  ]);
  await page.close();
  return out;
};

const state = (sw) =>
  sw.evaluate(async () => ({
    enabled: (await chrome.declarativeNetRequest.getEnabledRulesets()).sort(),
    dynamic: await chrome.declarativeNetRequest.getDynamicRules(),
    scripts: await chrome.scripting.getRegisteredContentScripts(),
    error: (await chrome.storage.session.get('blockingError')).blockingError,
  }));

// The worker applies settings asynchronously, so wait until Chrome shows the expected state (or give up after 10 s).
const settle = async (sw, done) => {
  const end = Date.now() + 10_000;
  for (;;) {
    const s = await state(sw);
    if (done(s) || Date.now() > end) return s;
    await sleep(100);
  }
};

const setBlocking = (sw, blocking) =>
  sw.evaluate(async (b) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, blocking: { ...settings.blocking, ...b } } });
  }, blocking);

const ids = (s) => s.scripts.map((r) => r.id).sort();

try {
  const { ctx, sw, id } = await launch();
  check('the service worker starts', sw && /^[a-p]{32}$/.test(id), id);

  const meta = await sw.evaluate(() => fetch(chrome.runtime.getURL('meta.json')).then((r) => r.json()));
  const generic = RULESETS.filter((f) => meta.features[f].hasGenericCss);
  const SCRIPTS = [...generic.map((f) => `generic-${f}`), 'deny-notifications'].sort();
  const allOn = (s) => s.enabled.join() === [...RULESETS].sort().join() && ids(s).join() === SCRIPTS.join();

  let s = await settle(sw, allOn);
  const { settings: stored } = await sw.evaluate(() => chrome.storage.local.get('settings'));
  check('on install, the default settings are stored', stored?.version === 1 && stored.blocking.denyNotifications === true && stored.blocking.lists.ai === false, json(stored));
  check('every default list is enabled, and nothing else', s.enabled.join() === [...RULESETS].sort().join(), json(s.enabled));
  check(
    'the generic CSS and the notification blocker are registered at document_start in every frame, and persist',
    ids(s).join() === SCRIPTS.join() && s.scripts.every((r) => r.allFrames && r.runAt === 'document_start' && r.persistAcrossSessions),
    json(s.scripts.map(({ excludeMatches, ...r }) => r)),
  );
  const excluded = generic.map((f) => [f, s.scripts.find((r) => r.id === `generic-${f}`)?.excludeMatches?.length ?? 0, meta.features[f].genericExcept.length]);
  check(
    `Chrome accepts each generic CSS registration with all its excluded hosts (ads ${meta.features.ads.genericExcept.length}, cookies ${meta.features.cookies.genericExcept.length})`,
    excluded.every(([, got, want]) => got === want) && !s.error,
    json({ excluded, error: s.error }),
  );
  check('AI search summaries ships with no ruleset and no generic CSS', meta.features.ai.ruleset === null && !meta.features.ai.hasGenericCss, json(meta.features.ai));
  const card = await ctx.newPage();
  await card.goto('chrome://extensions');
  const info = await card.evaluate((extId) => new Promise((r) => chrome.developerPrivate.getExtensionInfo(extId, r)), id);
  const warnings = [...info.installWarnings, ...info.manifestErrors.map((e) => e.message), ...info.runtimeErrors.map((e) => e.message)];
  check('Chrome shows no warning or error on the extension card', warnings.length === 0, json(warnings));
  await card.close();

  let hits = await visit(ctx, ADS);
  check('the fixture page and its own script load', hits.includes('/ads.html') && hits.includes('/control.js'), json(hits));
  check('the ad request is blocked', !hits.includes('/pagead/x.js'), json(hits));
  check('the tracker request is blocked', !hits.includes('/sieve-tracker.js'), json(hits));

  await setBlocking(sw, { lists: { ...stored.blocking.lists, ads: false, trackers: false } });
  s = await settle(sw, (s) => !s.enabled.includes('ads') && !s.enabled.includes('trackers') && !ids(s).includes('generic-ads'));
  check(
    'switching Ads and Trackers off disables those lists and their generic CSS, and nothing else',
    s.enabled.join() === 'antiadblock,cookies,distraction' && ids(s).join() === SCRIPTS.filter((i) => i !== 'generic-ads' && i !== 'generic-trackers').join(),
    json({ enabled: s.enabled, scripts: ids(s) }),
  );
  hits = await visit(ctx, ADS);
  check('with Ads and Trackers off, the ad and tracker requests reach the server', hits.includes('/pagead/x.js') && hits.includes('/sieve-tracker.js'), json(hits));
  await setBlocking(sw, { lists: stored.blocking.lists });
  s = await settle(sw, allOn);

  await setBlocking(sw, { paused: true });
  s = await settle(sw, (s) => s.enabled.length === 0 && s.scripts.length === 0);
  check('Pause everywhere turns every list off and unregisters every script', s.enabled.length === 0 && s.scripts.length === 0 && s.dynamic.length === 0, json({ enabled: s.enabled, scripts: ids(s) }));
  hits = await visit(ctx, ADS);
  check('while paused, the ad request reaches the server', hits.includes('/pagead/x.js'), json(hits));
  await setBlocking(sw, { paused: false });
  s = await settle(sw, allOn);
  hits = await visit(ctx, ADS);
  check('Resume brings every list and script back, and the ad request is blocked again', allOn(s) && hits.includes('/ads.html') && !hits.includes('/pagead/x.js'), json(hits));

  await setBlocking(sw, { allowlist: [{ kind: 'site', host: 'localhost' }] });
  const excludes = (pattern) => (s) => s.scripts.length > 0 && s.scripts.every((r) => r.excludeMatches?.includes(pattern));
  s = await settle(sw, (s) => s.dynamic.some((r) => r.id === ALLOW_ID) && excludes('*://*.localhost/*')(s));
  const allow = s.dynamic.find((r) => r.id === ALLOW_ID);
  check('an allowlisted site gets an allow rule above every list rule', allow?.action.type === 'allowAllRequests' && allow.priority === meta.maxPriority + 1, json(s.dynamic));
  check('an allowlisted site is excluded from every registered script', s.scripts.length === SCRIPTS.length && s.scripts.every((r) => r.excludeMatches?.includes('*://*.localhost/*')), json(ids(s)));
  hits = await visit(ctx, ADS);
  check('on allowlisted localhost, the ad and tracker requests reach the server', hits.includes('/pagead/x.js') && hits.includes('/sieve-tracker.js'), json(hits));
  hits = await visit(ctx, ADS_IP);
  check('on 127.0.0.1, which is not allowlisted, the ad request is still blocked', hits.includes('/ads.html') && !hits.includes('/pagead/x.js'), json(hits));

  await ctx.grantPermissions(['notifications']);
  await setBlocking(sw, { allowlist: [{ kind: 'site', host: 'localhost' }, { kind: 'page', url: ADS_IP }, { kind: 'site', host: '192.168.1.10' }] });
  s = await settle(sw, (s) => s.dynamic.length === 3 && excludes('*://192.168.1.10/*')(s));
  check(
    'Chrome accepts an IP site entry and a page entry in the allow rules and the excluded patterns',
    s.dynamic.length === 3 && !s.error && s.scripts.every((r) => r.excludeMatches?.includes('*://192.168.1.10/*') && r.excludeMatches.includes('*://127.0.0.1/ads.html*')),
    json({ rules: s.dynamic.length, error: s.error }),
  );
  hits = await visit(ctx, ADS_IP);
  const pageAnswers = await askNotifications(ctx, ADS_IP);
  check('an allowlisted page with a port gets its ad request through and no notification blocker', hits.includes('/pagead/x.js') && pageAnswers.join() === 'granted,granted,TypeError', json({ hits, pageAnswers }));
  await setBlocking(sw, { allowlist: [{ kind: 'site', host: 'localhost' }] });
  s = await settle(sw, (s) => s.dynamic.length === 1 && !s.scripts.some((r) => r.excludeMatches?.includes('*://192.168.1.10/*')));
  await sleep(300); // let that run finish its last call before counting

  const calls = await sw.evaluate(async () => {
    const counts = {};
    const originals = [];
    const wrap = (api, name) => {
      const fn = api[name];
      originals.push([api, name, fn]);
      api[name] = (...args) => {
        counts[name] = (counts[name] ?? 0) + 1;
        return fn.apply(api, args);
      };
    };
    for (const name of ['getDynamicRules', 'updateEnabledRulesets', 'updateDynamicRules']) wrap(chrome.declarativeNetRequest, name);
    for (const name of ['registerContentScripts', 'updateContentScripts', 'unregisterContentScripts']) wrap(chrome.scripting, name);
    wrap(chrome.storage.session, 'remove');
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, blocking: { ...settings.blocking, myFilters: '! only a comment' } } });
    for (let i = 0; i < 100 && !counts.remove; i++) await new Promise((r) => setTimeout(r, 50));
    for (const [api, name, fn] of originals) api[name] = fn;
    return counts;
  });
  check('a settings change that alters nothing makes no change in Chrome', calls.getDynamicRules === 1 && calls.remove === 1 && Object.keys(calls).length === 2, json(calls));

  await sw.evaluate(() => chrome.storage.local.set({ myRules: [{ id: 1, action: { type: 'block' }, condition: { regexFilter: '(' } }] }));
  s = await settle(sw, (s) => s.error);
  check(
    'when Chrome refuses a rule, blockingError says why and the allow rule stays on',
    typeof s.error?.message === 'string' && s.error.message.length > 0 && typeof s.error.at === 'number' && s.dynamic.map((r) => r.id).join() === String(ALLOW_ID),
    json({ error: s.error, rules: s.dynamic.map((r) => r.id) }),
  );
  await sw.evaluate(() => chrome.storage.local.set({ myRules: [] }));
  s = await settle(sw, (s) => !s.error);
  check('the next update that Chrome accepts clears blockingError', !s.error, json(s.error));

  await sw.evaluate(() => (globalThis.beforeStop = true));
  const status = await stopWorker(ctx);
  check('stopWorker stops the service worker', status === 'stopped', status);
  hits = await visit(ctx, ADS);
  check('with the worker stopped, allowlisted localhost still gets its ad request', hits.includes('/pagead/x.js'), json(hits));
  hits = await visit(ctx, ADS_IP);
  check('with the worker stopped, the ad request on 127.0.0.1 is still blocked', hits.includes('/ads.html') && !hits.includes('/pagead/x.js'), json(hits));

  const sw2 = await startWorker(ctx, id);
  const fresh = await sw2.evaluate(() => globalThis.beforeStop === undefined);
  s = await state(sw2);
  check(
    'in the new worker instance, the allow rule and every registered script are still there',
    fresh && s.dynamic.map((r) => r.id).join() === String(ALLOW_ID) && ids(s).join() === SCRIPTS.join() && s.scripts.every((r) => r.persistAcrossSessions),
    json({ fresh, rules: s.dynamic.map((r) => r.id), scripts: ids(s) }),
  );

  let answers = await askNotifications(ctx, ADS_IP);
  check('with Site notification requests on, a page is told "denied" and cannot subscribe to push', answers.join() === 'denied,denied,NotAllowedError', json(answers));
  answers = await askNotifications(ctx, ADS);
  check('on an allowlisted site, the page gets its real notification permission', answers.join() === 'granted,granted,TypeError', json(answers));
  await setBlocking(sw2, { denyNotifications: false });
  s = await settle(sw2, (s) => !ids(s).includes('deny-notifications'));
  answers = await askNotifications(ctx, ADS_IP);
  check('with Site notification requests off, the page gets its real permission', !ids(s).includes('deny-notifications') && answers.join() === 'granted,granted,TypeError', json(answers));

  await setBlocking(sw2, { allowlist: [] });
  s = await settle(sw2, (s) => s.dynamic.length === 0);
  hits = await visit(ctx, ADS);
  check('after the restart, the worker still applies changes: removing localhost blocks its ad request again', s.dynamic.length === 0 && hits.includes('/ads.html') && !hits.includes('/pagead/x.js'), json(hits));
  await ctx.close();
} catch (e) {
  check('the run finished without an exception', false, String(e?.stack ?? e).split('\n').slice(0, 4).join(' | '));
} finally {
  servers.http.close();
  servers.https.close();
}

if (errors.length) console.log('page errors:', errors);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
