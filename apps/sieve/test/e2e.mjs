// Real Chromium with the built extension (run `pnpm --filter sieve build` first). Not part of `pnpm test`.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual as same } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { SITE_HOST, UNHIDE_HOST, check, launch, results, startServers, startWorker, stopWorker } from './harness.mjs';

const RULESETS = ['ads', 'trackers', 'distraction', 'cookies', 'antiadblock'];
const ALLOW_ID = 1_000_000;
const servers = await startServers();
// A built rule that only changes headers on one whole host: its matches must not be counted as blocked ads.
const headerRule = ['antiadblock', 'ads', 'trackers'].flatMap((ruleset) => {
  try {
    return JSON.parse(readFileSync(new URL(`../dist/rules/${ruleset}.json`, import.meta.url), 'utf8'))
      .filter((r) => r.action.type === 'modifyHeaders' && /^\|\|[a-z0-9.-]+\^$/.test(r.condition.urlFilter ?? '') && Object.keys(r.condition).length === 2 && r.condition.resourceTypes.includes('script') && r.condition.resourceTypes.includes('main_frame'))
      .map((r) => ({ ruleset, id: r.id, host: r.condition.urlFilter.slice(2, -1) }));
  } catch {
    return [];
  }
})[0];
const ADS = `https://localhost:${servers.httpsPort}/ads.html`;
const ADS_IP = `https://127.0.0.1:${servers.httpsPort}/ads.html`;
const errors = [];
const SHOTS = process.env.SHOTS ?? tmpdir();
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
  const { ctx, sw, id } = await launch({ extraHosts: headerRule ? [headerRule.host] : [] });
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
  const cardProblems = async () => {
    const card = await ctx.newPage();
    await card.goto('chrome://extensions');
    const info = await card.evaluate((extId) => new Promise((r) => chrome.developerPrivate.getExtensionInfo(extId, r)), id);
    await card.close();
    return [...info.installWarnings, ...info.manifestErrors.map((e) => e.message), ...info.runtimeErrors.map((e) => e.message)];
  };
  const warnings = await cardProblems();
  check('Chrome shows no warning or error on the extension card', warnings.length === 0, json(warnings));

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

  // null is junk Sieve must skip; the regex is one Chrome refuses.
  await sw.evaluate(() => chrome.storage.local.set({ myRules: [null, { id: 1, action: { type: 'block' }, condition: { regexFilter: '(' } }] }));
  s = await settle(sw, (s) => s.error);
  check(
    'when Chrome refuses a rule, blockingError says why and the allow rule stays on',
    typeof s.error?.message === 'string' && s.error.message.length > 0 && typeof s.error.at === 'number' && s.dynamic.map((r) => r.id).join() === String(ALLOW_ID),
    json({ error: s.error, rules: s.dynamic.map((r) => r.id) }),
  );
  await setBlocking(sw, { paused: true });
  s = await settle(sw, (s) => s.enabled.length === 0 && s.dynamic.length === 0);
  await setBlocking(sw, { paused: false });
  s = await settle(sw, (s) => allOn(s) && s.dynamic.some((r) => r.id === ALLOW_ID) && s.error);
  hits = await visit(ctx, ADS);
  check(
    'with a refused My filters rule stored, Pause then Resume still lets allowlisted localhost through, and blockingError stays set',
    allOn(s) && s.dynamic.map((r) => r.id).join() === String(ALLOW_ID) && typeof s.error?.message === 'string' && hits.includes('/pagead/x.js'),
    json({ rules: s.dynamic.map((r) => r.id), error: s.error, hits }),
  );
  await setBlocking(sw, { allowlist: [{ kind: 'site', host: 'localhost' }, { kind: 'site', host: '127.0.0.1' }] });
  s = await settle(sw, (s) => s.dynamic.some((r) => r.id === ALLOW_ID + 1) && s.error);
  hits = await visit(ctx, ADS_IP);
  check(
    'with a refused My filters rule stored, a newly allowlisted site gets its ad request through, and blockingError stays set',
    s.dynamic.some((r) => r.id === ALLOW_ID + 1) && typeof s.error?.message === 'string' && hits.includes('/pagead/x.js'),
    json({ rules: s.dynamic.map((r) => r.id), error: s.error, hits }),
  );
  await setBlocking(sw, { allowlist: [{ kind: 'site', host: 'localhost' }] });
  await sw.evaluate(() => chrome.storage.local.set({ myRules: [] }));
  const denyExcludes = (s, pattern) => s.scripts.find((r) => r.id === 'deny-notifications')?.excludeMatches?.includes(pattern);
  s = await settle(sw, (s) => !s.error && s.dynamic.length === 1 && !denyExcludes(s, '*://127.0.0.1/*'));
  check('the next update that Chrome accepts clears blockingError', !s.error && s.dynamic.map((r) => r.id).join() === String(ALLOW_ID), json({ error: s.error, rules: s.dynamic.map((r) => r.id) }));

  await sw.evaluate(() => (globalThis.beforeStop = true));
  const status = await stopWorker(ctx);
  check('stopWorker stops the service worker', status === 'stopped', status);
  hits = await visit(ctx, ADS);
  check('after stopping the worker, allowlisted localhost still gets its ad request', hits.includes('/pagead/x.js'), json(hits));
  hits = await visit(ctx, ADS_IP);
  check('after stopping the worker, the ad request on 127.0.0.1 is still blocked', hits.includes('/ads.html') && !hits.includes('/pagead/x.js'), json(hits));

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
  // Some lists exempt localhost from their generic CSS themselves (genericExcept), so only the others must drop it.
  const keepsLocalhost = (s) =>
    s.scripts.some((r) => r.excludeMatches?.includes('*://*.localhost/*') && !meta.features[r.id.replace('generic-', '')]?.genericExcept.includes('localhost'));
  s = await settle(sw2, (s) => s.dynamic.length === 0 && !keepsLocalhost(s));
  hits = await visit(ctx, ADS);
  check(
    'after the restart, the worker still applies changes: removing localhost blocks its ad request again and clears its exclusions',
    s.dynamic.length === 0 && !keepsLocalhost(s) && !s.error && hits.includes('/ads.html') && !hits.includes('/pagead/x.js'),
    json({ rules: s.dynamic.length, excludes: s.scripts.map((r) => [r.id, r.excludeMatches?.length ?? 0]), error: s.error, hits }),
  );

  await sw2.evaluate(() => {
    globalThis.injectErrors = [];
    const error = console.error;
    console.error = (...a) => (globalThis.injectErrors.push(a.map(String).join(' ')), error(...a));
  });
  const SITE = `https://${SITE_HOST}:${servers.httpsPort}/site.html`;
  const EMBED = `https://${UNHIDE_HOST}:${servers.httpsPort}/embed.html`;
  // [.adsbygoogle display, site-specific element display, #adbar display, reading window.g00gletag throws]
  const look = (frame) =>
    frame.evaluate(() => {
      const display = (s) => {
        const el = document.querySelector(s);
        return el && getComputedStyle(el).display;
      };
      let throws = false;
      try {
        window.g00gletag;
      } catch {
        throws = true;
      }
      return [display('ins.adsbygoogle'), display('.widget_media_image'), display('#adbar'), throws];
    });
  // Injection lands after `load` on a cold worker, so wait for `ready`; with none, Sieve must do nothing, so give it 1 s to (wrongly) act.
  const visitSite = async (url, ready) => {
    servers.hits.length = 0;
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url, { waitUntil: 'load' });
    const frames = [page.mainFrame(), page.frames().find((f) => f.url().endsWith('/frame.html'))];
    const end = Date.now() + (ready ? 5_000 : 1_000);
    let seen = await Promise.all(frames.map(look));
    while (!ready?.(seen) && Date.now() < end) {
      await sleep(100);
      seen = await Promise.all(frames.map(look));
    }
    await page.close();
    return { hits: [...servers.hits], main: seen[0], frame: seen[1] };
  };
  const hidden = (v) => v[0] === 'none' && v[1] === 'none' && v[3] === true;
  const shown = (v) => v[0] !== 'none' && v[1] !== 'none' && v[3] === false;

  let r = await visitSite(SITE, ([m, f]) => hidden(m) && hidden(f));
  check('the generic <ins class="adsbygoogle"> is display: none', r.main[0] === 'none' && !r.hits.includes('/pagead/x.js'), json(r));
  check(`the EasyList rule ${SITE_HOST}##.widget_media_image hides the element there`, r.main[1] === 'none', json(r));
  check(`the scriptlet abort-on-property-read g00gletag runs on ${SITE_HOST}: reading window.g00gletag throws`, r.main[3] === true, json(r));
  check(
    'in a same-origin iframe, the ad request is blocked, .adsbygoogle and the site-specific element are hidden, and the scriptlet runs',
    r.hits.includes('/frame.html') && !r.hits.includes('/pagead/frame.js') && hidden(r.frame),
    json(r),
  );
  r = await visitSite(`https://${UNHIDE_HOST}:${servers.httpsPort}/site.html`, ([m]) => m[0] === 'none');
  check(
    `on ${UNHIDE_HOST}, kept out of the registered ads stylesheet, the page gets the generic CSS minus its #adbar exception, and no other site's rules`,
    r.main[0] === 'none' && r.main[2] === 'block' && r.main[1] === 'block' && r.main[3] === false,
    json(r),
  );
  r = await visitSite(EMBED, ([, f]) => f[1] === 'none' && f[3] === true);
  check(`a ${SITE_HOST} iframe inside a srcdoc frame on another site gets its own site's hiding and scriptlet`, r.frame[1] === 'none' && r.frame[3] === true, json(r));

  await setBlocking(sw2, { allowlist: [{ kind: 'site', host: SITE_HOST }] });
  s = await settle(sw2, excludes(`*://*.${SITE_HOST}/*`));
  r = await visitSite(SITE);
  check(
    'on an allowlisted site, the ad request loads, .adsbygoogle and the site-specific element stay visible, and no scriptlet runs',
    r.hits.includes('/pagead/x.js') && shown(r.main),
    json(r),
  );
  check('on an allowlisted site, the iframe ad request loads, and nothing in the iframe is hidden or run', r.hits.includes('/pagead/frame.js') && shown(r.frame), json(r));
  r = await visitSite(EMBED);
  check(
    `an iframe from allowlisted ${SITE_HOST} on a site that is not allowlisted loads its ad request, and nothing in it is hidden or run`,
    r.hits.includes('/pagead/frame.js') && shown(r.frame),
    json(r),
  );
  await setBlocking(sw2, { allowlist: [{ kind: 'site', host: UNHIDE_HOST }] });
  s = await settle(sw2, (s) => !s.scripts.some((r) => r.excludeMatches?.includes(`*://*.${SITE_HOST}/*`)));
  r = await visitSite(EMBED);
  // The registered generic CSS still hides .adsbygoogle in that cross-site frame (README, Known limits), so it is not checked here.
  check(
    `on an allowlisted site, a ${SITE_HOST} iframe nested in a srcdoc frame loads its ad request and gets no site-specific hiding or scriptlet`,
    r.hits.includes('/pagead/frame.js') && r.frame[1] === 'block' && r.frame[3] === false,
    json(r),
  );
  await setBlocking(sw2, { allowlist: [], paused: true });
  s = await settle(sw2, (s) => s.enabled.length === 0 && s.scripts.length === 0);
  r = await visitSite(SITE);
  check(
    'while paused, the page and iframe ad requests load, nothing is hidden and no scriptlet runs',
    r.hits.includes('/pagead/x.js') && r.hits.includes('/pagead/frame.js') && shown(r.main) && shown(r.frame),
    json(r),
  );
  await setBlocking(sw2, { paused: false });
  s = await settle(sw2, (s) => s.enabled.length > 0);
  r = await visitSite(SITE, ([m, f]) => hidden(m) && hidden(f));
  check('Resume brings the site-specific hiding and the scriptlet back', hidden(r.main) && hidden(r.frame) && !r.hits.includes('/pagead/x.js'), json(r));
  const injectErrors = await sw2.evaluate(() => globalThis.injectErrors);
  check('the service worker logged no error while injecting', injectErrors?.length === 0, json(injectErrors));
  // Playwright can't click the toolbar button, so popup.html?tab=<id> stands in for it.
  const COUNTS = `https://localhost:${servers.httpsPort}/counts.html`;
  const COUNTS_WWW = `https://www.localhost:${servers.httpsPort}/counts.html`;
  const until = async (read, ok, ms = 10_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await read();
      if (ok(v) || Date.now() > end) return v;
      await sleep(100);
    }
  };
  const tabs = (w) => w.evaluate(() => chrome.tabs.query({}).then((ts) => ts.map((t) => [t.id, t.url])));
  const tabFor = async (w, url) => (await tabs(w)).find(([, u]) => u === url)?.[0];
  const badgeOf = (w, tabId) => w.evaluate((t) => chrome.action.getBadgeText({ tabId: t }), tabId);
  const blockingOf = async (w) => (await w.evaluate(() => chrome.storage.local.get('settings'))).settings.blocking;
  const countsOf = (w, tabId) => w.evaluate((k) => chrome.storage.session.get(k).then((r) => r[k]), `counts:${tabId}`);
  const menu = async (tabId, colorScheme = 'light') => {
    const pop = await ctx.newPage();
    const problems = [];
    pop.on('pageerror', (e) => problems.push(e.message));
    pop.on('console', (msg) => msg.type() === 'error' && problems.push(msg.text()));
    await pop.emulateMedia({ colorScheme });
    await pop.setViewportSize({ width: 340, height: 700 });
    await pop.goto(`chrome-extension://${id}/popup.html?tab=${tabId}`);
    await pop.locator('footer').waitFor();
    return { pop, problems, countsText: () => pop.locator('.counts').innerText() };
  };
  const SENTENCE = '3 ads and 2 trackers blocked on this page';

  const counted = await ctx.newPage();
  await counted.goto(COUNTS, { waitUntil: 'load' });
  const countedId = await tabFor(sw2, COUNTS);
  const badge = await until(() => badgeOf(sw2, countedId), (t) => t === '5');
  check('a page with 3 ad and 2 tracker requests shows 5 on the toolbar badge', badge === '5', json({ badge, counts: await countsOf(sw2, countedId) }));
  let m = await menu(countedId);
  check(`the menu says "${SENTENCE}"`, (await m.countsText()) === SENTENCE, await m.countsText());
  const switchCount = await m.pop.getByRole('switch').count();
  check('the menu has the header switch, the site switch and four feature switches, and no tab bar (one tab)', switchCount === 6 && (await m.pop.locator('[role=tablist]').count()) === 0, String(switchCount));
  await m.pop.screenshot({ path: join(SHOTS, 'menu.png'), fullPage: true });
  await m.pop.emulateMedia({ colorScheme: 'dark' });
  await sleep(400); // the buttons and switches fade between themes
  await m.pop.screenshot({ path: join(SHOTS, 'menu-dark.png'), fullPage: true });
  await m.pop.close();

  const stopped = await stopWorker(ctx);
  m = await menu(countedId);
  check('after the worker is stopped, the menu still says 3 ads and 2 trackers', stopped === 'stopped' && (await m.countsText()) === SENTENCE, json({ stopped, text: await m.countsText() }));
  await m.pop.close();
  const sw4 = await startWorker(ctx, id);
  check('after the worker is stopped, the badge still shows 5', (await badgeOf(sw4, countedId)) === '5', await badgeOf(sw4, countedId));
  await sw4.evaluate(() => {
    globalThis.countErrors = [];
    const error = console.error;
    console.error = (...a) => (globalThis.countErrors.push(a.map(String).join(' ')), error(...a));
  });
  await counted.reload({ waitUntil: 'load' });
  const again = await until(() => badgeOf(sw4, countedId), (t) => t === '5');
  m = await menu(countedId);
  check('a reload starts the count from zero again, and the restarted worker counts: 3 ads and 2 trackers, not 6 and 4', again === '5' && (await m.countsText()) === SENTENCE, json({ again, text: await m.countsText(), counts: await countsOf(sw4, countedId) }));

  const toggled = (label) => m.pop.getByRole('switch', { name: label });
  const buttonOf = (name) => m.pop.getByRole('button', { name, exact: true });
  const allowlistIs = (want) => until(async () => (await blockingOf(sw4)).allowlist, (a) => same(a, want));
  const listsOn = (st) => st.enabled.join() === [...RULESETS].sort().join();
  const hasAllowRule = (on) => settle(sw4, (st) => st.dynamic.some((r) => r.id === ALLOW_ID) === on);

  const held = await toggled('Distraction control').elementHandle();
  await sw4.evaluate((k) => chrome.storage.session.set({ [k]: { ads: 9, trackers: 4 } }), `counts:${countedId}`);
  await m.pop.getByText('9 ads and 4 trackers blocked on this page').waitFor();
  const stillThere = await held.evaluate((el) => el.isConnected);
  await held.click({ timeout: 3000 }).catch(() => {});
  const dropped = await until(async () => (await blockingOf(sw4)).lists.distraction, (v) => v === false);
  check('a count change updates the number in place: the switch the owner is about to click stays in the page and still works', stillThere && dropped === false, json({ stillThere, dropped }));
  await toggled('Distraction control').setChecked(true);
  await until(async () => (await blockingOf(sw4)).lists.distraction, (v) => v === true);
  await sw4.evaluate((k) => chrome.storage.session.set({ [k]: { ads: 3, trackers: 2 } }), `counts:${countedId}`);

  const clickBoth = () =>
    m.pop.evaluate(() => {
      for (const key of ['distraction', 'cookies']) document.querySelector(`[data-id="${key}"]`).click();
    });
  const pair = async () => {
    const { lists } = await blockingOf(sw4);
    return `${lists.distraction},${lists.cookies}`;
  };
  await clickBoth();
  const both = await until(pair, (v) => v === 'false,false');
  await clickBoth();
  const back = await until(pair, (v) => v === 'true,true');
  check('two switches changed at the same moment are both saved', both === 'false,false' && back === 'true,true', json({ both, back }));

  await toggled('Block on this site').uncheck();
  let list = await allowlistIs([{ kind: 'site', host: 'localhost' }]);
  check('turning off "Block on this site" allowlists the tab host', same(list, [{ kind: 'site', host: 'localhost' }]), json(list));
  check('the menu tells the owner to reload to see the change', await m.pop.getByText('Reload this page to see the change.').isVisible());
  await hasAllowRule(true);
  servers.hits.length = 0;
  await counted.reload({ waitUntil: 'load' });
  check('after turning it off and reloading, the ad request reaches the server', servers.hits.includes('/pagead/c1.js'), json(servers.hits));
  await toggled('Block on this site').check();
  list = await allowlistIs([]);
  check('turning "Block on this site" back on removes the entry', json(list) === '[]' && (await toggled('Block on this site').isChecked()), json(list));
  await hasAllowRule(false);

  await buttonOf('Pause on this page').click();
  list = await allowlistIs([{ kind: 'page', url: COUNTS }]);
  check('"Pause on this page" adds a page entry, and the button becomes "Resume on this page"', same(list, [{ kind: 'page', url: COUNTS }]) && (await buttonOf('Resume on this page').isVisible()), json(list));
  await hasAllowRule(true);
  servers.hits.length = 0;
  await counted.reload({ waitUntil: 'load' });
  check('on a paused page, the ad request reaches the server', servers.hits.includes('/pagead/c1.js'), json(servers.hits));
  await buttonOf('Resume on this page').click();
  list = await allowlistIs([]);
  check('"Resume on this page" removes the page entry', json(list) === '[]' && (await buttonOf('Pause on this page').isVisible()), json(list));
  await hasAllowRule(false);

  const wwwPage = await ctx.newPage();
  await wwwPage.goto(COUNTS_WWW, { waitUntil: 'load' });
  const www = await menu(await tabFor(sw4, COUNTS_WWW));
  const wwwHost = await www.pop.locator('.host').innerText();
  await www.pop.getByRole('switch', { name: 'Block on this site' }).uncheck();
  list = await allowlistIs([{ kind: 'site', host: 'localhost' }]);
  check('on www.localhost the menu shows localhost, and turning the site off allowlists localhost without the www.', wwwHost === 'localhost' && same(list, [{ kind: 'site', host: 'localhost' }]), json({ wwwHost, list }));
  await www.pop.getByRole('switch', { name: 'Block on this site' }).check();
  await allowlistIs([]);
  await www.pop.close();
  await wwwPage.close();

  const built = await sw4.evaluate(async () => {
    const meta = await fetch(chrome.runtime.getURL('meta.json')).then((r) => r.json());
    const out = {};
    for (const [f, v] of Object.entries(meta.features)) {
      if (!v.ruleset) continue;
      const rules = await fetch(chrome.runtime.getURL(`rules/${v.ruleset}.json`)).then((r) => r.json());
      out[f] = [rules.filter((r) => r.action.type === 'modifyHeaders').map((r) => r.id).join(), (v.modifyIds ?? []).join()];
    }
    return out;
  });
  const headerRules = Object.values(built).reduce((n, [ids]) => n + (ids ? ids.split(',').length : 0), 0);
  check(`meta.json lists, for each list, the ids of its rules that only change headers (${headerRules} in all)`, headerRules > 0 && Object.values(built).every(([want, got]) => want === got), json(built));
  check('the built lists have a header-only rule on one whole host to test with', headerRule !== undefined);
  if (headerRule) {
    const headerUrl = `https://${headerRule.host}:${servers.httpsPort}/counts.html`;
    const headerPage = await ctx.newPage();
    await headerPage.goto(headerUrl, { waitUntil: 'load' });
    const headerId = await tabFor(sw4, headerUrl);
    const headerBadge = await until(() => badgeOf(sw4, headerId), (t) => t === '5');
    await sleep(500);
    const matched = await sw4.evaluate((t) => chrome.declarativeNetRequest.getMatchedRules({ tabId: t }).then((r) => r.rulesMatchedInfo.map((i) => `${i.rule.rulesetId}:${i.rule.ruleId}`)), headerId);
    const header = await menu(headerId);
    const headerText = await header.countsText();
    check(
      `on ${headerRule.host}, where a rule only changes headers on every request, those matches are not counted: still ${SENTENCE}`,
      matched.includes(`${headerRule.ruleset}:${headerRule.id}`) && headerText === SENTENCE && (await badgeOf(sw4, headerId)) === '5',
      json({ headerBadge, headerText, matched: matched.length }),
    );
    await header.pop.close();
    await headerPage.close();
  }

  const flips = [
    ['Distraction control', (b) => b.lists.distraction, true],
    ['Cookie banners', (b) => b.lists.cookies, true],
    ['AI search summaries', (b) => b.lists.ai, false],
    ['Site notification requests', (b) => b.denyNotifications, false],
  ];
  for (const [label, read, was] of flips) {
    await toggled(label).setChecked(!was);
    const flipped = await until(async () => read(await blockingOf(sw4)), (v) => v === !was);
    await toggled(label).setChecked(was);
    const restored = await until(async () => read(await blockingOf(sw4)), (v) => v === was);
    check(`the "${label}" switch changes its setting and changes it back`, flipped === !was && restored === was, json({ flipped, restored }));
  }
  await buttonOf('Pause everywhere').click();
  await m.pop.getByText('Blocking is paused everywhere').waitFor();
  s = await settle(sw4, (st) => st.enabled.length === 0);
  check('"Pause everywhere" pauses blocking, and the menu says so with a Resume button in place of it', (await blockingOf(sw4)).paused === true && s.enabled.length === 0 && (await buttonOf('Pause everywhere').count()) === 0, json({ enabled: s.enabled }));
  await buttonOf('Resume').click();
  s = await settle(sw4, listsOn);
  check('"Resume" brings blocking back', (await blockingOf(sw4)).paused === false && listsOn(s), json({ enabled: s.enabled }));
  await m.pop.getByRole('switch', { name: 'Sieve on' }).uncheck();
  s = await settle(sw4, (st) => st.enabled.length === 0);
  check('the "Sieve on" switch turns Sieve off, and the rest of the menu goes inert', s.enabled.length === 0 && (await m.pop.locator('.stack[inert]').count()) === 1, json({ enabled: s.enabled }));
  await m.pop.getByRole('switch', { name: 'Sieve on' }).check();
  s = await settle(sw4, listsOn);

  await sleep(300); // an apply still finishing would clear the error just set
  await sw4.evaluate(() => chrome.storage.session.set({ blockingError: { message: 'Chrome refused a rule', at: Date.now() } }));
  await m.pop.getByRole('alert').waitFor();
  const banner = await m.pop.getByRole('alert').innerText();
  check('the error banner shows the stored message, then how to fix it', banner === 'Chrome refused a rule. Turn a list off in Settings to make room.', banner);
  await sw4.evaluate(() => chrome.storage.session.remove('blockingError'));
  await m.pop.getByRole('alert').waitFor({ state: 'detached' });
  await m.pop.close();

  const before = new Set((await tabs(sw4)).map(([i]) => i));
  const extensions = await ctx.newPage();
  await extensions.goto('chrome://extensions');
  m = await menu((await tabs(sw4)).map(([i]) => i).find((i) => !before.has(i)));
  check(
    `on a chrome:// tab the menu says "Sieve doesn't run on this page.", has no counts or site switch, and logs no page errors`,
    (await m.pop.getByText("Sieve doesn't run on this page.").isVisible()) && (await m.pop.locator('.counts').count()) === 0 && (await m.pop.getByRole('switch', { name: 'Block on this site' }).count()) === 0 && m.problems.length === 0,
    json(m.problems),
  );
  await m.pop.close();
  await extensions.close();

  const v6 = http.createServer((_, res) => res.end('<!doctype html><title>v6</title>'));
  await new Promise((r) => v6.listen(0, '::1', r));
  const V6 = `http://[::1]:${v6.address().port}/`;
  const v6Page = await ctx.newPage();
  await v6Page.goto(V6, { waitUntil: 'load' });
  m = await menu(await tabFor(sw4, V6));
  check(
    'on an IPv6 tab the menu offers no "Block on this site" switch, says why, and cannot pause the page',
    (await m.pop.getByRole('switch', { name: 'Block on this site' }).count()) === 0 &&
      (await m.pop.getByText("Sieve can't turn blocking off for this address.").isVisible()) &&
      (await buttonOf('Pause on this page').isDisabled()) &&
      m.problems.length === 0,
    json(m.problems),
  );
  await m.pop.close();
  await v6Page.close();
  v6.close();

  await counted.close();
  const gone = await until(() => countsOf(sw4, countedId), (c) => c === undefined);
  check('closing the tab deletes its counts', gone === undefined, json(gone));
  const countErrors = await sw4.evaluate(() => globalThis.countErrors);
  check('the service worker logged no error while counting', countErrors?.length === 0, json(countErrors));
  const lateWarnings = await cardProblems();
  check('after the worker and the menu ran all of this, the extension card still shows no warning or error', lateWarnings.length === 0, json(lateWarnings));
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
