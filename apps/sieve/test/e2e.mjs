// Real Chromium with the built extension (run `pnpm --filter sieve build` first). Not part of `pnpm test`.
import { check, launch, results, startServers, stopWorker } from './harness.mjs';

const RULESETS = ['ads', 'trackers', 'distraction', 'cookies', 'antiadblock'];
const servers = await startServers();
const ADS = `https://localhost:${servers.httpsPort}/ads.html`;
const errors = [];

const visit = async (ctx, url) => {
  servers.hits.length = 0;
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.close();
  return [...servers.hits];
};

try {
  const { ctx, sw, id } = await launch();
  check('the service worker starts', sw && /^[a-p]{32}$/.test(id), id);

  const enabled = await sw.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
  check('every default list is enabled', RULESETS.every((r) => enabled.includes(r)), JSON.stringify(enabled));
  check('AI search summaries is off', !enabled.includes('ai'), JSON.stringify(enabled));
  const card = await ctx.newPage();
  await card.goto('chrome://extensions');
  const info = await card.evaluate((extId) => new Promise((r) => chrome.developerPrivate.getExtensionInfo(extId, r)), id);
  const warnings = [...info.installWarnings, ...info.manifestErrors.map((e) => e.message), ...info.runtimeErrors.map((e) => e.message)];
  check('Chrome shows no warning or error on the extension card', warnings.length === 0, JSON.stringify(warnings).slice(0, 500));
  await card.close();

  let hits = await visit(ctx, ADS);
  check('the fixture page and its own script load', hits.includes('/ads.html') && hits.includes('/control.js'), JSON.stringify(hits));
  check('the ad request is blocked', !hits.includes('/pagead/x.js'), JSON.stringify(hits));
  check('the tracker request is blocked', !hits.includes('/sieve-tracker.js'), JSON.stringify(hits));

  await sw.evaluate((ids) => chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: ids }), RULESETS);
  hits = await visit(ctx, ADS);
  check('with the lists off, the ad and tracker requests reach the server', hits.includes('/pagead/x.js') && hits.includes('/sieve-tracker.js'), JSON.stringify(hits));
  await sw.evaluate((ids) => chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: ids }), RULESETS);

  const status = await stopWorker(ctx);
  check('stopWorker stops the service worker', status === 'stopped', status);
  hits = await visit(ctx, ADS);
  check('with the worker stopped, the ad request is still blocked', hits.includes('/ads.html') && !hits.includes('/pagead/x.js'), JSON.stringify(hits));
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
