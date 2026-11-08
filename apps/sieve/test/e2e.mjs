// Real Chromium with the built extension (run `pnpm --filter sieve build` first). Not part of `pnpm test`.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual as same } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { AD_HOST, SITE_HOST, TRACKER_HOST, UNHIDE_HOST, check, launch, results, startServers, startWorker, stopWorker } from './harness.mjs';

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
      const passes = (a) => !['block', 'allow', 'allowAllRequests'].includes(a.type) && !(a.type === 'redirect' && !a.redirect?.transform);
      out[f] = [rules.filter((r) => passes(r.action)).map((r) => r.id).join(), (v.modifyIds ?? []).join()];
    }
    return out;
  });
  const headerRules = Object.values(built).reduce((n, [ids]) => n + (ids ? ids.split(',').length : 0), 0);
  check(`meta.json lists, for each list, the ids of its rules that block and allow nothing: header changes, $removeparam (${headerRules} in all)`, headerRules > 0 && Object.values(built).every(([want, got]) => want === got), json(built));
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
  check('on a chrome:// tab the menu has no "Block an item on this page" button', (await buttonOf('Block an item on this page').count()) === 0);
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
  check('on an IPv6 tab "Block an item on this page" is disabled, so the picker cannot start', await buttonOf('Block an item on this page').isDisabled());
  await m.pop.close();
  await v6Page.close();
  v6.close();

  await counted.close();
  const gone = await until(() => countsOf(sw4, countedId), (c) => c === undefined);
  check('closing the tab deletes its counts', gone === undefined, json(gone));
  const countErrors = await sw4.evaluate(() => globalThis.countErrors);
  check('the service worker logged no error while counting', countErrors?.length === 0, json(countErrors));
  // The element picker: the menu button starts it, as it does from the toolbar. pick.html is the page, and the worker is stopped part-way.
  const PICK = `https://localhost:${servers.httpsPort}/pick.html`;
  const PICK_CSP = `https://localhost:${servers.httpsPort}/pick-csp.html`;
  const PICKER = 'sieve-picker';
  const pickPage = await ctx.newPage();
  pickPage.on('pageerror', (e) => errors.push(e.message));
  await pickPage.setViewportSize({ width: 760, height: 460 });
  await pickPage.goto(PICK, { waitUntil: 'load' });
  let pw = sw4;
  const pickButton = (mm) => mm.pop.getByRole('button', { name: 'Block an item on this page', exact: true });
  const startPicker = async (page, url) => {
    const mm = await menu(await tabFor(pw, url));
    await pickButton(mm).click();
    await page.locator(PICKER).waitFor({ state: 'attached' });
    await mm.pop.close().catch(() => {});
    await page.bringToFront();
  };
  const pickerCount = (page) => page.locator(PICKER).count();
  const inPicker = (page, sel) => page.locator(`${PICKER} ${sel}`);
  const choose = async (page, item) => {
    await page.hover(item);
    await page.click(item);
    await inPicker(page, '.selector').waitFor({ state: 'visible' });
  };
  const selectorOf = (page) => inPicker(page, '.selector').innerText();
  const hidesOf = (page) => inPicker(page, 'p[aria-live]').innerText();
  const pbtn = (name) => pickPage.getByRole('button', { name, exact: true });
  const displayOf = (page, sel) => page.evaluate((q) => getComputedStyle(document.querySelector(q)).display, sel);
  const myFiltersOf = async (w) => (await blockingOf(w)).myFilters;
  const hideDataOf = (w) => w.evaluate(() => chrome.storage.local.get('myCosmetic').then((r) => r.myCosmetic?.hide));
  const rects = (page) =>
    page.evaluate(() => {
      const r = (el) => [el.left, el.top, el.width, el.height].map(Math.round);
      const root = document.querySelector('sieve-picker').shadowRoot;
      return { box: r(root.querySelector('.box').getBoundingClientRect()), item: r(document.querySelector('a.promo').getBoundingClientRect()) };
    });
  const paint = (page) =>
    page.evaluate(() => {
      const root = document.querySelector('sieve-picker').shadowRoot;
      const css = (el) => getComputedStyle(el);
      return { panel: css(root.querySelector('.panel')).backgroundColor, position: css(root.querySelector('.panel')).position, primary: css(root.querySelector('.ui-btn--primary')).backgroundColor };
    });

  m = await menu(await tabFor(pw, PICK));
  check('on a web page the menu enables "Block an item on this page"', await pickButton(m).isEnabled());
  const rulesBefore = await state(pw);
  await pickButton(m).click();
  await pickPage.locator(PICKER).waitFor({ state: 'attached' });
  await m.pop.close().catch(() => {});
  await pickPage.bringToFront();
  const opened = await pickPage.evaluate(() => ({ open: document.querySelector('sieve-picker').shadowRoot !== null, host: document.documentElement.contains(document.querySelector('sieve-picker')) }));
  check(
    'the picker opens in an open shadow root on the page, asks the owner to click an item, and shows no "Block it" yet, even though the page styles its tag display: none',
    opened.open && opened.host && (await inPicker(pickPage, '.panel').isVisible()) && (await inPicker(pickPage, 'p.ui-meta').innerText()) === 'Click the item you want to block. Esc cancels.' && !(await pbtn('Block it').isVisible()) && (await pbtn('Cancel').isVisible()),
    json(opened),
  );
  await pickPage.hover('a.promo');
  const hovered = await rects(pickPage);
  check('hovering an item outlines exactly that item', same(hovered.box, hovered.item), json(hovered));

  await pickPage.click('a.promo');
  await inPicker(pickPage, '.selector').waitFor({ state: 'visible' });
  const clicks = await pickPage.evaluate(() => window.clicks);
  check('clicking an item picks it without the page seeing the click: selector a.promo, "Hides 1 item on this page"', (await selectorOf(pickPage)) === 'a.promo' && (await hidesOf(pickPage)) === 'Hides 1 item on this page' && clicks === 0, json({ clicks }));
  const atOne = await pbtn('Less').isDisabled();
  await pbtn('More').click();
  const wider = [await selectorOf(pickPage), await hidesOf(pickPage)];
  await pbtn('More').click();
  const top = [await selectorOf(pickPage), await pbtn('More').isDisabled()];
  await pbtn('Less').click();
  await pbtn('Less').click();
  const narrower = [await selectorOf(pickPage), await pbtn('Less').isDisabled()];
  check(
    '"More" widens the selector one level at a time, "Less" narrows it again, and each stops at its end',
    atOne && same(wider, ['div.wrap > a.promo', 'Hides 1 item on this page']) && same(top, ['body:nth-of-type(1) > div.wrap > a.promo', true]) && same(narrower, ['a.promo', true]),
    json({ atOne, wider, top, narrower }),
  );

  await pbtn('More').click();
  const light = await paint(pickPage);
  await pickPage.screenshot({ path: join(SHOTS, 'picker.png') });
  await pickPage.emulateMedia({ colorScheme: 'dark' });
  await sleep(400); // the buttons fade between themes
  const dark = await paint(pickPage);
  await pickPage.screenshot({ path: join(SHOTS, 'picker-dark.png') });
  await pickPage.emulateMedia({ colorScheme: 'light' });
  check(
    'the panel takes the shared tokens: a white sheet and a teal "Block it" in light, a dark sheet and a bright one in dark',
    light.panel === 'rgb(255, 255, 255)' && light.primary === 'rgb(14, 116, 144)' && dark.panel === 'rgb(20, 35, 36)' && dark.primary === 'rgb(34, 211, 238)' && light.position === 'fixed',
    json({ light, dark }),
  );

  await pickPage.keyboard.press('Escape');
  await pickPage.locator(PICKER).waitFor({ state: 'detached' });
  await pickPage.mouse.move(300, 300);
  await pickPage.click('a.promo');
  check('Esc closes the picker, and the page gets its clicks again', (await pickerCount(pickPage)) === 0 && (await pickPage.evaluate(() => window.clicks)) === 1, String(await pickPage.evaluate(() => window.clicks)));

  await startPicker(pickPage, PICK);
  await choose(pickPage, '.note');
  const plural = [await selectorOf(pickPage), await hidesOf(pickPage)];
  await pbtn('Cancel').click();
  check('a selector that finds two items says "Hides 2 items on this page", and Cancel closes the picker', same(plural, ['p.note', 'Hides 2 items on this page']) && (await pickerCount(pickPage)) === 0, json(plural));

  await startPicker(pickPage, PICK);
  await choose(pickPage, '#main-ad');
  check('an item with an id gets #main-ad, and "More" has nowhere to go', (await selectorOf(pickPage)) === '#main-ad' && (await pbtn('More').isDisabled()));
  await pickPage.keyboard.press('Escape');
  await pickPage.locator(PICKER).waitFor({ state: 'detached' });

  await startPicker(pickPage, PICK);
  await choose(pickPage, '.grp .dup >> nth=0');
  const fewest = [await selectorOf(pickPage), await hidesOf(pickPage)];
  await pickPage.keyboard.press('Escape');
  await pickPage.locator(PICKER).waitFor({ state: 'detached' });
  check('when no selector finds only the item, the picker starts at the one that finds the fewest: section.grp > p.dup with 2 items, not p.dup with 3', same(fewest, ['section.grp > p.dup', 'Hides 2 items on this page']), json(fewest));

  const filtersBeforeCancel = await myFiltersOf(pw);
  const clicksBeforeCancel = await pickPage.evaluate(() => window.clicks);
  await startPicker(pickPage, PICK);
  const cancelBox = await pbtn('Cancel').boundingBox();
  await pickPage.mouse.move(20, 20);
  await pickPage.mouse.move(cancelBox.x + cancelBox.width / 2, cancelBox.y + cancelBox.height / 2, { steps: 25 });
  await pickPage.mouse.down();
  await pickPage.mouse.up();
  await sleep(300);
  check(
    'before an item is picked, a pointer that crosses the panel still clicks Cancel: the picker closes, and the item under the panel is not picked, hidden or saved',
    (await pickerCount(pickPage)) === 0 && (await myFiltersOf(pw)) === filtersBeforeCancel && (await pickPage.evaluate(() => window.clicks)) === clicksBeforeCancel && (await displayOf(pickPage, '.corner')) !== 'none',
    json({ open: await pickerCount(pickPage), filters: await myFiltersOf(pw) }),
  );

  await startPicker(pickPage, PICK);
  await pickPage.evaluate(() => (document.querySelector('sieve-picker').dataset.first = 'yes'));
  await startPicker(pickPage, PICK);
  await pickPage.locator('sieve-picker[data-first]').waitFor({ state: 'detached' });
  await choose(pickPage, '#main-ad');
  const twice = [await pickerCount(pickPage), await selectorOf(pickPage)];
  await pickPage.keyboard.press('Escape');
  await pickPage.locator(PICKER).waitFor({ state: 'detached' });
  const clicksTwice = await pickPage.evaluate(() => window.clicks);
  await pickPage.click('.note >> nth=0');
  check(
    'running the picker again while it is open leaves one picker that works, and after Esc nothing of the first is left to swallow the page\'s clicks',
    same(twice, [1, '#main-ad']) && (await pickPage.evaluate(() => window.clicks)) === clicksTwice + 1,
    json({ twice, clicks: await pickPage.evaluate(() => window.clicks), clicksTwice }),
  );

  await startPicker(pickPage, PICK);
  await pickPage.evaluate(() => document.querySelector('sieve-picker').remove());
  const clicksBeforeRemoval = await pickPage.evaluate(() => window.clicks);
  await pickPage.click('.note >> nth=0');
  await pickPage.click('.note >> nth=0');
  check('when the page removes the picker, the next pointer event ends it for good, so the page gets its clicks', (await pickPage.evaluate(() => window.clicks)) === clicksBeforeRemoval + 2, String(await pickPage.evaluate(() => window.clicks)));

  await startPicker(pickPage, PICK);
  await choose(pickPage, 'a.promo');
  await pbtn('More').click();
  await pickPage.evaluate(() => {
    const root = document.querySelector('sieve-picker').shadowRoot;
    root.querySelector('.ui-btn--primary').click();
    root.querySelector('.ui-btn--primary').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Cancel').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.querySelector('.note').click();
  });
  await sleep(700);
  check(
    'a page that clicks "Block it" or "Cancel" itself, sends Escape or clicks another item changes nothing: the picker stays, nothing is hidden or saved',
    (await pickerCount(pickPage)) === 1 && (await selectorOf(pickPage)) === 'div.wrap > a.promo' && (await displayOf(pickPage, 'a.promo')) !== 'none' && !(await myFiltersOf(pw)).includes('localhost##') && (await hideDataOf(pw)) === undefined,
    json({ filters: await myFiltersOf(pw), selector: await selectorOf(pickPage) }),
  );

  await pbtn('Block it').click();
  const hiddenNow = await until(() => displayOf(pickPage, 'a.promo'), (d) => d === 'none');
  const stored1 = await until(() => myFiltersOf(pw), (f) => f.includes('localhost##'));
  check(
    'a real click on "Block it" hides the item at once, closes the picker, and adds localhost##div.wrap > a.promo to My filters (below the comment already there) and to the hide data',
    hiddenNow === 'none' && (await pickerCount(pickPage)) === 0 && stored1 === '! only a comment\nlocalhost##div.wrap > a.promo' && same(await hideDataOf(pw), { localhost: ['div.wrap > a.promo'] }),
    json({ hiddenNow, stored1, hide: await hideDataOf(pw) }),
  );
  await sleep(800); // the save also reaches the worker's settings listener, which must find nothing to change
  const rulesAfter = await state(pw);
  check(
    'picking an item leaves the lists, the registered scripts and the dynamic rules as they were',
    same(rulesAfter.enabled, rulesBefore.enabled) && same(rulesAfter.scripts, rulesBefore.scripts) && same(rulesAfter.dynamic, rulesBefore.dynamic) && same(rulesAfter.error, rulesBefore.error),
    json({ enabled: rulesAfter.enabled, scripts: ids(rulesAfter), dynamic: rulesAfter.dynamic.length }),
  );

  await pickPage.reload({ waitUntil: 'load' });
  const reloaded = await until(() => displayOf(pickPage, 'a.promo'), (d) => d === 'none', 5_000);
  check('after a reload the item is still hidden, and the others are not', reloaded === 'none' && (await displayOf(pickPage, '.note')) !== 'none', reloaded);

  const pickStatus = await stopWorker(ctx);
  await pickPage.reload({ waitUntil: 'load' });
  const restarted = await until(() => displayOf(pickPage, 'a.promo'), (d) => d === 'none', 5_000);
  check('after the worker is stopped, a reload still hides the item', pickStatus === 'stopped' && restarted === 'none', json({ pickStatus, restarted }));
  pw = await startWorker(ctx, id);
  await pw.evaluate(() => {
    globalThis.pickErrors = [];
    const error = console.error;
    console.error = (...a) => (globalThis.pickErrors.push(a.map(String).join(' ')), error(...a));
  });

  await startPicker(pickPage, PICK);
  await choose(pickPage, '#main-ad');
  await pbtn('Block it').click();
  const second = await until(async () => (await hideDataOf(pw))?.localhost?.length, (n) => n === 2);
  check(
    'a second pick, handled by the restarted worker, is added to the first in My filters and the hide data',
    second === 2 && (await myFiltersOf(pw)) === '! only a comment\nlocalhost##div.wrap > a.promo\nlocalhost###main-ad' && same(await hideDataOf(pw), { localhost: ['div.wrap > a.promo', '#main-ad'] }) && (await until(() => displayOf(pickPage, '#main-ad'), (d) => d === 'none')) === 'none',
    json({ filters: await myFiltersOf(pw), hide: await hideDataOf(pw) }),
  );

  const WWW = `https://www.localhost:${servers.httpsPort}/pick.html`;
  const wwwPick = await ctx.newPage();
  await wwwPick.setViewportSize({ width: 760, height: 460 });
  await wwwPick.goto(WWW, { waitUntil: 'load' });
  await startPicker(wwwPick, WWW);
  await choose(wwwPick, '.note >> nth=0');
  await wwwPick.getByRole('button', { name: 'Block it', exact: true }).click();
  const wwwSaved = await until(async () => (await hideDataOf(pw))?.['www.localhost'], (v) => v !== undefined);
  await wwwPick.reload({ waitUntil: 'load' });
  const wwwHidden = await until(() => displayOf(wwwPick, '.note'), (d) => d === 'none', 5_000);
  await pickPage.reload({ waitUntil: 'load' });
  await until(() => displayOf(pickPage, 'a.promo'), (d) => d === 'none', 5_000);
  check(
    'a pick on a www. page is saved under www.localhost, hides there after a reload, and leaves localhost itself alone',
    same(wwwSaved, ['p.note']) && (await myFiltersOf(pw)).endsWith('\nwww.localhost##p.note') && wwwHidden === 'none' && (await displayOf(pickPage, '.note')) !== 'none',
    json({ wwwSaved, wwwHidden, filters: await myFiltersOf(pw) }),
  );
  await wwwPick.close();

  m = await menu(await tabFor(pw, PICK));
  const refused = await m.pop.evaluate(() => chrome.runtime.sendMessage({ type: 'pick', host: 'localhost', selector: '.zzz' }));
  check('a pick sent from the menu page, which is not a web page, is refused and saves nothing', refused?.ok === false && !(await myFiltersOf(pw)).includes('.zzz'), json(refused));
  await m.pop.close();
  const pickBlocking = await blockingOf(pw);
  await setBlocking(pw, { allowlist: [{ kind: 'site', host: 'localhost' }] });
  m = await menu(await tabFor(pw, PICK));
  const offHere = await pickButton(m).isDisabled();
  await m.pop.close();
  await setBlocking(pw, { paused: true });
  m = await menu(await tabFor(pw, PICK));
  const pausedAll = await pickButton(m).isDisabled();
  await m.pop.close();
  await setBlocking(pw, { allowlist: pickBlocking.allowlist, paused: false });
  check('where blocking is off for the page, or paused everywhere, "Block an item on this page" is disabled', offHere && pausedAll, json({ offHere, pausedAll }));
  await settle(pw, (st) => st.enabled.length > 0);

  const cspPage = await ctx.newPage();
  await cspPage.setViewportSize({ width: 760, height: 460 });
  await cspPage.goto(PICK_CSP, { waitUntil: 'load' });
  await startPicker(cspPage, PICK_CSP);
  await choose(cspPage, 'span.csp-item');
  const strict = await paint(cspPage);
  check('on a page whose policy allows no styles, the picker is still drawn from the shared tokens', strict.position === 'fixed' && strict.panel === 'rgb(255, 255, 255)' && strict.primary === 'rgb(14, 116, 144)', json(strict));
  await cspPage.keyboard.press('Escape');
  await cspPage.close();
  await pickPage.close();
  const pickErrors = await pw.evaluate(() => globalThis.pickErrors);
  check('the service worker logged no error while handling picks', pickErrors?.length === 0, json(pickErrors));

  const OPTIONS = `chrome-extension://${id}/options.html`;
  const helper = await ctx.newPage();
  await helper.goto(ADS, { waitUntil: 'load' });
  m = await menu(await tabFor(pw, ADS));
  await m.pop.getByRole('button', { name: 'Settings', exact: true }).click();
  const fromMenu = await until(async () => ctx.pages().find((p) => p.url().startsWith(OPTIONS)), (p) => p !== undefined);
  check("the menu's Settings button opens the settings page in a tab", fromMenu !== undefined && m.problems.length === 0, json({ pages: ctx.pages().map((p) => p.url()), problems: m.problems }));
  await m.pop.close();
  await fromMenu?.close();
  await helper.close();

  const opt = await ctx.newPage();
  const optProblems = [];
  opt.on('pageerror', (e) => optProblems.push(e.message));
  opt.on('console', (msg) => msg.type() === 'error' && optProblems.push(msg.text()));
  await opt.setViewportSize({ width: 800, height: 900 });
  await opt.goto(OPTIONS);
  await opt.getByRole('heading', { name: 'Allowlist' }).waitFor();
  const optSwitch = (name) => opt.getByRole('switch', { name, exact: true });
  const labelsIn = (n) => opt.locator('section').nth(n).locator('label.switch').allInnerTexts();
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const builtAt = new Date(meta.builtAt);
  const footer = `Lists built on ${builtAt.getDate()} ${MONTHS[builtAt.getMonth()]} ${builtAt.getFullYear()}. Rebuild Sieve to update them.`;
  const NAMES = { ads: 'Ads', trackers: 'Trackers', distraction: 'Distraction control', cookies: 'Cookie banners', antiadblock: 'Ad blocker warnings', ai: 'AI search summaries' };
  const rows = Object.entries(NAMES).map(([f, name]) => (meta.features[f].ruleCount ? `${name} · ${meta.features[f].ruleCount.toLocaleString('en-US')} rules` : name));
  const headings = await opt.getByRole('heading', { level: 2 }).allInnerTexts();
  const blockingLabels = (await labelsIn(0)).map((t) => t.trim());
  const rowLabels = (await labelsIn(1)).map((t) => t.trim());
  check(
    `the settings page has Blocking (the menu's four switches, Ad blocker warnings and Trackers), Filter lists ("${rows[0]}", AI search summaries by name only), My filters and Allowlist, and says when the lists were built`,
    same(headings, ['Blocking', 'Filter lists', 'My filters', 'Allowlist']) &&
      same(blockingLabels, ['Distraction control', 'Cookie banners', 'AI search summaries', 'Site notification requests', 'Ad blocker warnings', 'Trackers']) &&
      same(rowLabels, rows) &&
      (await opt.getByText(footer, { exact: true }).isVisible()),
    json({ headings, blockingLabels, rowLabels, footer }),
  );
  await opt.screenshot({ path: join(SHOTS, 'settings.png'), fullPage: true });
  await opt.emulateMedia({ colorScheme: 'dark' });
  await sleep(400); // the switches fade between themes
  await opt.screenshot({ path: join(SHOTS, 'settings-dark.png'), fullPage: true });
  await opt.emulateMedia({ colorScheme: 'light' });

  await optSwitch('Trackers').uncheck();
  s = await settle(pw, (st) => !st.enabled.includes('trackers'));
  const rowFollows = await opt.getByRole('switch', { name: rows[1], exact: true }).isChecked();
  hits = await visit(ctx, ADS);
  const trackerThrough = hits.includes('/sieve-tracker.js');
  await optSwitch('Trackers').check();
  s = await settle(pw, listsOn);
  hits = await visit(ctx, ADS);
  check(
    'turning off "Trackers" lets the tracker request through (and the Trackers list row follows), and turning it on blocks it again',
    trackerThrough && rowFollows === false && listsOn(s) && hits.includes('/ads.html') && !hits.includes('/sieve-tracker.js'),
    json({ trackerThrough, rowFollows, hits }),
  );

  const filtersBox = opt.getByRole('textbox', { name: 'My filters' });
  const typeFilters = (text) =>
    filtersBox.evaluate((el, t) => {
      el.value = t;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
  const pressSave = async () => {
    await opt.getByRole('button', { name: 'Save', exact: true }).click();
    await opt.waitForFunction(() => !document.querySelector('.result').textContent.includes('Saving'), null, { timeout: 60_000 });
    return opt.locator('.result').innerText();
  };
  const TRACKER_FILTER = `||${TRACKER_HOST}^$third-party`;
  const firstText = `${TRACKER_FILTER}\nnot a filter ##\n`;
  await typeFilters(firstText);
  let said = await pressSave();
  await opt.locator('section').nth(2).screenshot({ path: join(SHOTS, 'settings-saved.png') });
  await optSwitch('Trackers').uncheck();
  s = await settle(pw, (st) => !st.enabled.includes('trackers') && st.dynamic.some((r) => r.id === 1));
  hits = await visit(ctx, ADS);
  let mineStored = await pw.evaluate(() => chrome.storage.local.get(['myRules', 'myRuleSources']));
  check(
    'saving a good filter and a bad line says "Saved 1 filter." and "Line 2: ..." in plain words, and with the Trackers list off the saved filter still blocks the tracker',
    said.startsWith('Saved 1 filter.\n') &&
      said.includes("Line 2: Sieve can't read this line as a filter. Check it for typos and stray spaces.") &&
      hits.includes('/ads.html') &&
      !hits.includes('/sieve-tracker.js') &&
      mineStored.myRules?.length === 1 &&
      same(mineStored.myRuleSources, { 1: TRACKER_FILTER }),
    json({ said, hits, mineStored }),
  );

  const before40k = await state(pw);
  const started40k = Date.now();
  await typeFilters(Array.from({ length: 40_000 }, (_, i) => `||host${i}.example^`).join('\n'));
  said = await pressSave();
  const took40k = Date.now() - started40k;
  const after40k = await state(pw);
  hits = await visit(ctx, ADS);
  mineStored = await pw.evaluate(() => chrome.storage.local.get(['myRules']));
  check(
    `saving 40,000 rules, past Chrome's dynamic limit, shows Chrome's refusal, and the earlier filter stays on and stored (${took40k} ms)`,
    said.startsWith('Chrome refused these filters, so the ones saved before stay on.') &&
      said.length > 'Chrome refused these filters, so the ones saved before stay on. Remove some filters or fix the one Chrome names, then save again. Chrome says: '.length &&
      same(after40k.dynamic, before40k.dynamic) &&
      !after40k.error &&
      (await blockingOf(pw)).myFilters === firstText &&
      mineStored.myRules?.length === 1 &&
      !hits.includes('/sieve-tracker.js'),
    json({ said: said.slice(0, 400), dynamic: after40k.dynamic.length, error: after40k.error, hits }),
  );

  await typeFilters(Array.from({ length: 5_000 }, (_, i) => `garbage line ${i} ##`).join('\n'));
  said = await pressSave();
  const listed = await opt.locator('.errors li').allInnerTexts();
  check(
    'saving 5,000 garbage lines says "Saved 0 filters.", lists the first 50 by line, then "and 4,950 more"',
    said.startsWith('Saved 0 filters.\n') && listed.length === 50 && listed[0].startsWith('Line 1: ') && listed[49].startsWith('Line 50: ') && said.trimEnd().endsWith('and 4,950 more'),
    json({ said: said.slice(0, 200), listed: listed.length, end: said.slice(-40) }),
  );
  await optSwitch('Trackers').check();
  s = await settle(pw, (st) => listsOn(st) && st.dynamic.length === 0);

  // ins.adsbygoogle[data-ad-client] is in the ads list's generic CSS, which a My filters exception can only lift per page.
  const genericOut = (st, host) => st.scripts.filter((x) => x.id.startsWith('generic-')).every((x) => x.excludeMatches?.includes(`*://*.${host}/*`));
  await typeFilters(`${SITE_HOST}#@#ins.adsbygoogle[data-ad-client]\n##p.note`);
  said = await pressSave();
  s = await settle(pw, (st) => genericOut(st, SITE_HOST));
  r = await visitSite(SITE, ([main]) => main[0] !== 'none' && main[2] === 'none' && main[3] === true);
  check(
    `a My filters ${SITE_HOST}#@# exception lifts a list's generic rule there: the ad shows, while the rest of the generic CSS, the site's own hiding and its scriptlet still apply`,
    said.startsWith('Saved 2 filters.') && genericOut(s, SITE_HOST) && r.main[0] !== 'none' && r.main[1] === 'none' && r.main[2] === 'none' && r.main[3] === true,
    json({ said, main: r.main, excludes: s.scripts.map((x) => [x.id, x.excludeMatches?.includes(`*://*.${SITE_HOST}/*`)]) }),
  );
  const notePage = await ctx.newPage();
  await notePage.goto(PICK, { waitUntil: 'load' });
  const noteHidden = await until(() => displayOf(notePage, '.note'), (d) => d === 'none', 5_000);
  await notePage.close();
  check('a My filters line with no site (##p.note) hides on every site', noteHidden === 'none', noteHidden);

  await typeFilters('! settings page test');
  said = await pressSave();
  s = await settle(pw, (st) => !st.scripts.some((x) => x.excludeMatches?.includes(`*://*.${SITE_HOST}/*`)));
  check(`saving My filters without the exception puts ${SITE_HOST} back under the registered generic CSS`, said.startsWith('Saved 0 filters.') && !s.scripts.some((x) => x.excludeMatches?.includes(`*://*.${SITE_HOST}/*`)), json(said));

  const addressBox = opt.getByRole('textbox', { name: 'Site or page address' });
  const allowIs = (want) => until(async () => (await blockingOf(pw)).allowlist, (a) => same(a, want));
  await addressBox.fill('example.com');
  await opt.getByRole('button', { name: 'Add', exact: true }).click();
  list = await allowIs([{ kind: 'site', host: 'example.com' }]);
  await opt.locator('.entries li').first().waitFor();
  const entryText = await opt.locator('.entries li').allInnerTexts();
  check('adding "example.com" to the allowlist lists it with a Remove button', same(list, [{ kind: 'site', host: 'example.com' }]) && entryText.length === 1 && entryText[0].startsWith('example.com'), json({ list, entryText }));
  await opt.getByRole('button', { name: 'Remove example.com', exact: true }).click();
  list = await allowIs([]);
  await opt.locator('.entries li').first().waitFor({ state: 'detached' });
  check('"Remove" takes it off the allowlist and off the page', json(list) === '[]', json(list));
  await addressBox.fill('[::1]');
  await opt.getByRole('button', { name: 'Add', exact: true }).click();
  const refusedText = await opt.getByRole('alert').innerText();
  check(
    'an address Sieve cannot allowlist (IPv6) says "Enter a site like example.com or a full page address." and adds nothing',
    refusedText === 'Enter a site like example.com or a full page address.' && json((await blockingOf(pw)).allowlist) === '[]',
    refusedText,
  );

  // The page is a second writer of the settings: a pick saved by the worker while it is open must survive what the page saves next.
  const pickWrite = (line, hold = 0) =>
    pw.evaluate(
      ([l, ms]) =>
        navigator.locks.request('sieve-settings', async () => {
          const { settings } = await chrome.storage.local.get('settings');
          await new Promise((r) => setTimeout(r, ms));
          await chrome.storage.local.set({ settings: { ...settings, blocking: { ...settings.blocking, myFilters: `${settings.blocking.myFilters}\n${l}` } } });
        }),
      [line, hold],
    );
  await pickWrite('localhost##.picked-one');
  const followed = await until(() => filtersBox.inputValue(), (v) => v.endsWith('\nlocalhost##.picked-one'));
  await optSwitch('Cookie banners').uncheck();
  const afterSwitch = await until(() => blockingOf(pw), (b) => b.lists.cookies === false);
  check(
    'a pick saved while the settings page is open shows in the untouched text area and survives a switch change made after it',
    followed.endsWith('\nlocalhost##.picked-one') && afterSwitch.lists.cookies === false && afterSwitch.myFilters.endsWith('\nlocalhost##.picked-one'),
    json({ followed, afterSwitch }),
  );
  await optSwitch('Cookie banners').check();
  await until(() => blockingOf(pw), (b) => b.lists.cookies === true);

  await filtersBox.evaluate((el) => {
    el.value += '\nexample.com##.mine-x';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await pickWrite('localhost##.picked-two');
  await opt.getByText('Your filters changed while this page was open.', { exact: false }).waitFor();
  const kept = await filtersBox.inputValue();
  said = await pressSave();
  const merged = (await blockingOf(pw)).myFilters.split('\n');
  check(
    "with the text edited, a pick saved meanwhile is announced, the owner's text stays, and Save keeps both",
    kept.endsWith('\nexample.com##.mine-x') && !kept.includes('picked-two') && ['example.com##.mine-x', 'localhost##.picked-one', 'localhost##.picked-two'].every((l) => merged.includes(l)) && said.startsWith('Saved 3 filters.'),
    json({ kept, merged, said }),
  );

  const big = Array.from({ length: 20_000 }, (_, i) => `||big${i}.example^`).join('\n');
  await typeFilters(big);
  await opt.getByRole('button', { name: 'Save', exact: true }).click();
  const typedDuring = await filtersBox.evaluate((el) => {
    el.value += '\nexample.com##.typed-during-save';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return document.querySelector('.result').textContent;
  });
  await opt.waitForFunction(() => !document.querySelector('.result').textContent.includes('Saving'), null, { timeout: 60_000 });
  said = await opt.locator('.result').innerText();
  await optSwitch('Cookie banners').uncheck();
  await until(() => blockingOf(pw), (b) => b.lists.cookies === false);
  await sleep(300); // the page's own storage event for that switch
  const afterToggle = await filtersBox.inputValue();
  await optSwitch('Cookie banners').check();
  await until(() => blockingOf(pw), (b) => b.lists.cookies === true);
  await pickWrite('localhost##.picked-three');
  await opt.getByText('Saving keeps your text and adds the new lines after it.', { exact: false }).waitFor();
  const storedNow = (await blockingOf(pw)).myFilters;
  check(
    'text typed while a save runs stays in the box as an edit: a switch change does not wipe it, and a later pick is announced instead of replacing it',
    typedDuring === 'Saving…' &&
      said.startsWith('Saved 20,000 filters.') &&
      afterToggle.endsWith('\nexample.com##.typed-during-save') &&
      (await filtersBox.inputValue()).endsWith('\nexample.com##.typed-during-save') &&
      !storedNow.includes('typed-during-save') &&
      storedNow.endsWith('\nlocalhost##.picked-three'),
    json({ typedDuring, said: said.slice(0, 80), afterToggle: afterToggle.slice(-60), storedNow: storedNow.slice(-80) }),
  );

  // The worker holds the shared lock through a slow pick while the page saves 20,000 filters: the save must wait, see the pick and stop.
  const slowPick = pickWrite('localhost##.picked-slow', 1_500);
  await sleep(100);
  said = await pressSave();
  await slowPick;
  const afterSlowPick = (await blockingOf(pw)).myFilters.split('\n');
  const savedAgain = await pressSave();
  const bothKept = (await blockingOf(pw)).myFilters.split('\n');
  const keptRules = (await pw.evaluate(() => chrome.storage.local.get('myRules'))).myRules.length;
  check(
    'a pick that holds the settings lock during a large save is kept: the save waits, says the filters changed, and the next Save keeps the pick and the typed line',
    said.startsWith('Your filters changed while Sieve was saving them.') &&
      afterSlowPick.includes('localhost##.picked-slow') &&
      savedAgain.startsWith('Saved 20,003 filters.') &&
      ['example.com##.typed-during-save', 'localhost##.picked-three', 'localhost##.picked-slow'].every((l) => bothKept.includes(l)) &&
      keptRules === 20_000,
    json({ said: said.slice(0, 120), savedAgain: savedAgain.slice(0, 80), tail: bothKept.slice(-4), keptRules }),
  );
  await typeFilters('');
  await pressSave();

  // The DevTools panel. A script can't open DevTools, so panel.html?tab=<id> stands in for it, and a stub of chrome.devtools covers the paths only DevTools takes.
  const MANY = `https://localhost:${servers.httpsPort}/many.html`;
  const COLUMNS = ['Time', 'Type', 'Address', 'List', 'Filter'];
  const builtSource = (ruleset, host) => {
    const read = (dir) => JSON.parse(readFileSync(new URL(`../dist/${dir}/${ruleset}.json`, import.meta.url), 'utf8'));
    const rule = read('rules').find((r) => r.action.type === 'block' && r.condition.urlFilter === `||${host}^` && Object.keys(r.condition).length === 1);
    return read('sources')[rule?.id];
  };
  const AD_SOURCE = builtSource('ads', AD_HOST);
  const TRACKER_SOURCE = builtSource('trackers', TRACKER_HOST);
  const openPanel = async (tabId, { colorScheme = 'light', stub } = {}) => {
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('console', (msg) => msg.type() === 'error' && problems.push(msg.text()));
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 1100, height: 420 });
    if (stub) await page.addInitScript((s) => void (chrome.devtools = s), stub);
    await page.goto(`chrome-extension://${id}/panel.html${stub ? '' : `?tab=${tabId}`}`);
    return {
      page,
      problems,
      rows: () => page.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent))),
      status: () => page.locator('[role=status]').innerText(),
    };
  };
  const inPanel = (p, ok, ms) => until(() => p.rows(), ok, ms);
  const rowFor = (rows, part) => rows.find((r) => r[2].includes(part));
  const watchErrors = (w) =>
    w.evaluate(() => {
      globalThis.panelErrors = [];
      const error = console.error;
      console.error = (...a) => (globalThis.panelErrors.push(a.map(String).join(' ')), error(...a));
    });
  const matchedIn = (w, tabId) => w.evaluate((t) => chrome.declarativeNetRequest.getMatchedRules({ tabId: t }).then((r) => r.rulesMatchedInfo.map((i) => `${i.rule.rulesetId}:${i.rule.ruleId}`)), tabId);

  const inspected = await ctx.newPage();
  inspected.on('pageerror', (e) => errors.push(e.message));
  await inspected.goto(ADS, { waitUntil: 'load' });
  const inspectedId = await tabFor(pw, ADS);
  await watchErrors(pw);
  const panel = await openPanel(inspectedId);
  await panel.page.getByText('Reload the page to see what Sieve blocks.', { exact: true }).waitFor();
  check(
    'a panel opened on a page that has not loaded since says "Reload the page to see what Sieve blocks." and lists no rows',
    (await panel.status()) === 'Reload the page to see what Sieve blocks.' && (await panel.rows()).length === 0,
    json({ status: await panel.status(), rows: await panel.rows() }),
  );
  await panel.page.screenshot({ path: join(SHOTS, 'panel-empty.png') });
  await inspected.reload({ waitUntil: 'load' });
  let panelRows = await inPanel(panel, (r) => r.length === 2);
  const adRow = rowFor(panelRows, '/pagead/x.js');
  const trackerRow = rowFor(panelRows, '/sieve-tracker.js');
  const heads = await panel.page.locator('th').allTextContents();
  check(
    `reloading the page lists the blocked ad request: Type script, List Ads, and the list's own filter ${AD_SOURCE}`,
    adRow !== undefined &&
      /^\d\d:\d\d:\d\d$/.test(adRow[0]) &&
      adRow[1] === 'script' &&
      adRow[2] === `https://${AD_HOST}:${servers.httpsPort}/pagead/x.js` &&
      adRow[3] === 'Ads' &&
      adRow[4] === AD_SOURCE &&
      AD_SOURCE === `||${AD_HOST}^`,
    json({ adRow, AD_SOURCE }),
  );
  check(
    `and the blocked tracker request: List Trackers and filter ${TRACKER_SOURCE}; the columns are ${COLUMNS.join(', ')}`,
    trackerRow?.[3] === 'Trackers' && trackerRow[4] === TRACKER_SOURCE && TRACKER_SOURCE === `||${TRACKER_HOST}^` && same(heads, COLUMNS) && (await panel.status()) === '',
    json({ trackerRow, heads, status: await panel.status() }),
  );
  await inspected.reload({ waitUntil: 'load' });
  await sleep(800);
  panelRows = await panel.rows();
  check('a second reload clears the table first: 2 rows again, not 4', panelRows.length === 2, json(panelRows));

  await setBlocking(pw, { allowlist: [{ kind: 'site', host: 'localhost' }] });
  await settle(pw, (st) => st.dynamic.some((r) => r.id === ALLOW_ID));
  await inspected.reload({ waitUntil: 'load' });
  await sleep(800);
  const allowMatched = await matchedIn(pw, inspectedId);
  panelRows = await panel.rows();
  check(
    'on an allowlisted site Chrome matches the allow rule, and the panel adds no row for it: the table is empty and says to reload',
    allowMatched.includes(`_dynamic:${ALLOW_ID}`) && panelRows.length === 0 && (await panel.status()) === 'Reload the page to see what Sieve blocks.',
    json({ allowMatched: allowMatched.slice(-3), panelRows }),
  );
  await setBlocking(pw, { allowlist: [] });
  await settle(pw, (st) => !st.dynamic.some((r) => r.id === ALLOW_ID));

  check('the built lists have a header-only rule on one whole host to test the panel with', headerRule !== undefined);
  if (headerRule) {
    const headerUrl = `https://${headerRule.host}:${servers.httpsPort}/counts.html`;
    const headerPage = await ctx.newPage();
    await headerPage.goto(headerUrl, { waitUntil: 'load' });
    const headerTab = await tabFor(pw, headerUrl);
    const headerPanel = await openPanel(headerTab);
    await headerPage.reload({ waitUntil: 'load' });
    await inPanel(headerPanel, (r) => r.length >= 5);
    await sleep(800);
    panelRows = await headerPanel.rows();
    const headerMatched = await matchedIn(pw, headerTab);
    check(
      `on ${headerRule.host}, where a rule only changes headers on every request, the panel lists only the 5 blocked requests, not the header matches`,
      headerMatched.includes(`${headerRule.ruleset}:${headerRule.id}`) && panelRows.length === 5 && panelRows.every((r) => !r[2].endsWith('/counts.html')),
      json({ headerMatched: headerMatched.length, panelRows }),
    );
    await headerPanel.page.close();
    await headerPage.close();
  }

  const mineLoaded = (st) => st.dynamic.some((r) => r.condition.urlFilter?.includes('control.js'));
  await inspected.goto(ADS, { waitUntil: 'load' });
  await typeFilters('/control.js$script');
  await pressSave();
  await settle(pw, mineLoaded);
  await inspected.reload({ waitUntil: 'load' });
  panelRows = await inPanel(panel, (r) => r.length === 3);
  let mineRow = rowFor(panelRows, '/control.js');
  check(
    'a My filters rule that blocks a request is listed with List "My filters" and its own filter line',
    mineRow?.[1] === 'script' && mineRow[2] === `https://localhost:${servers.httpsPort}/control.js` && mineRow[3] === 'My filters' && mineRow[4] === '/control.js$script',
    json(panelRows),
  );
  await panel.page.screenshot({ path: join(SHOTS, 'panel.png'), fullPage: true });
  await panel.page.emulateMedia({ colorScheme: 'dark' });
  await sleep(400);
  await panel.page.screenshot({ path: join(SHOTS, 'panel-dark.png'), fullPage: true });
  await panel.page.emulateMedia({ colorScheme: 'light' });
  await typeFilters('/control.js$script,important');
  await pressSave();
  await sleep(500);
  await settle(pw, mineLoaded);
  await inspected.reload({ waitUntil: 'load' });
  panelRows = await inPanel(panel, (r) => r.length === 3);
  mineRow = rowFor(panelRows, '/control.js');
  check('after My filters is saved with another line for that request, the panel shows the new line, not the one it read before', mineRow?.[3] === 'My filters' && mineRow[4] === '/control.js$script,important', json(panelRows));
  await typeFilters('');
  await pressSave();
  await settle(pw, (st) => st.dynamic.length === 0);

  await inspected.goto(MANY, { waitUntil: 'load' });
  await panel.page.getByText('Showing the latest 500 requests.', { exact: true }).waitFor();
  await sleep(1000);
  panelRows = await panel.rows();
  check(
    'a load with 600 blocked requests keeps the newest 500 and says "Showing the latest 500 requests."',
    panelRows.length === 500 && (await panel.status()) === 'Showing the latest 500 requests.' && panelRows[0][2].endsWith('i=100') && panelRows[499][2].endsWith('i=599'),
    json({ n: panelRows.length, first: panelRows[0]?.[2], last: panelRows[panelRows.length - 1]?.[2], status: await panel.status() }),
  );
  await inspected.goto(ADS, { waitUntil: 'load' });
  panelRows = await inPanel(panel, (r) => r.length === 2);
  check('navigating away drops the old rows and the notice', panelRows.length === 2 && (await panel.status()) === '', json({ n: panelRows.length, status: await panel.status() }));

  const panelErrorsBefore = await pw.evaluate(() => globalThis.panelErrors);
  await panel.page.evaluate(() => {
    const el = document.querySelector('[role=status]');
    window.heard = [];
    new MutationObserver(() => window.heard.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
  });
  const panelStop = await stopWorker(ctx);
  await until(() => panel.page.evaluate(() => window.heard.some((t) => /reconnecting/i.test(t))), Boolean);
  const heard = await panel.page.evaluate(() => window.heard);
  await until(() => panel.status(), (t) => t === '');
  panelRows = await panel.rows();
  check(
    'when the worker stops, the panel says it is reconnecting, then connects again and keeps its rows',
    panelStop === 'stopped' && heard.some((t) => /^Sieve is reconnecting/.test(t)) && (await panel.status()) === '' && panelRows.length === 2,
    json({ panelStop, heard, status: await panel.status(), rows: panelRows.length }),
  );
  pw = await startWorker(ctx, id);
  await watchErrors(pw);
  await inspected.reload({ waitUntil: 'load' });
  await sleep(800);
  panelRows = await inPanel(panel, (r) => r.length === 2);
  check('after the restart, a reload reaches the reconnected panel: its rows are replaced by the new 2', panelRows.length === 2 && rowFor(panelRows, '/pagead/x.js') !== undefined && rowFor(panelRows, '/sieve-tracker.js') !== undefined, json(panelRows));

  const inDevTools = await openPanel(undefined, { stub: { inspectedWindow: { tabId: inspectedId }, panels: { themeName: 'dark' } } });
  await inspected.reload({ waitUntil: 'load' });
  panelRows = await inPanel(inDevTools, (r) => r.length === 2);
  const devToolsLook = await inDevTools.page.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor]);
  check(
    'inside DevTools the panel takes its tab from inspectedWindow.tabId and its theme from DevTools: dark, though the page asks for light',
    panelRows.length === 2 && devToolsLook[0] === 'dark' && devToolsLook[1] !== 'rgb(242, 247, 247)',
    json({ panelRows, devToolsLook }),
  );
  const devtoolsPage = await ctx.newPage();
  await devtoolsPage.addInitScript(() => {
    window.created = [];
    chrome.devtools = { panels: { create: (...a) => window.created.push(a) } };
  });
  await devtoolsPage.goto(`chrome-extension://${id}/devtools.html`);
  const created = await until(() => devtoolsPage.evaluate(() => window.created), (c) => c.length > 0);
  const present = await devtoolsPage.evaluate(() => Promise.all(['icon-32.png', 'panel.html'].map((f) => fetch(f).then((r) => r.ok))));
  const declared = await pw.evaluate(() => chrome.runtime.getManifest().devtools_page);
  check('the manifest names devtools.html, which adds a panel "Sieve" with icon-32.png and panel.html, and both files are in the extension', declared === 'devtools.html' && same(created, [['Sieve', 'icon-32.png', 'panel.html']]) && present.every(Boolean), json({ declared, created, present }));
  const panelErrorsAfter = await pw.evaluate(() => globalThis.panelErrors);
  check(
    'the panel pages and the service worker logged no errors while listing requests',
    [panel, inDevTools].every((p) => p.problems.length === 0) && panelErrorsBefore?.length === 0 && panelErrorsAfter?.length === 0,
    json({ panel: panel.problems, inDevTools: inDevTools.problems, panelErrorsBefore, panelErrorsAfter }),
  );
  for (const p of [panel.page, inDevTools.page, devtoolsPage, inspected]) await p.close();

  check('the settings page logged no errors', optProblems.length === 0, json(optProblems));
  await opt.close();

  const lateWarnings = await cardProblems();
  check('after the worker and the menu ran all of this, the extension card still shows no warning or error', lateWarnings.length === 0, json(lateWarnings));
  // Last of all, because reloading the extension from Chrome for Testing leaves it off: the picker still open on a page is then cut off from it.
  const reloadPage = await ctx.newPage();
  await reloadPage.setViewportSize({ width: 760, height: 460 });
  await reloadPage.goto(PICK, { waitUntil: 'load' });
  await startPicker(reloadPage, PICK);
  await choose(reloadPage, '.note >> nth=0');
  await pw.evaluate(() => chrome.runtime.reload()).catch(() => {});
  await sleep(2000);
  await reloadPage.getByRole('button', { name: 'Block it', exact: true }).click();
  await inPicker(reloadPage, '.error').waitFor({ state: 'visible' });
  const cutOff = await inPicker(reloadPage, '.error').innerText();
  const unstuck = await reloadPage.getByRole('button', { name: 'Block it', exact: true }).isEnabled();
  await reloadPage.keyboard.press('Escape');
  await reloadPage.locator(PICKER).waitFor({ state: 'detached' });
  check('after the extension reloads, "Block it" says why it cannot save and is ready for another try instead of sticking', cutOff === 'Sieve was reloaded or turned off. Reload this page, then try again.' && unstuck, json({ cutOff, unstuck }));
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
