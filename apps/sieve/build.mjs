import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { DEFAULT_SETTINGS, FEATURES, compileFilters, scriptletFunction, stripSections } from '@apps-hub/sieve-core';
import { checkRegexesWithRe2 } from '@apps-hub/sieve-core/src/node-regex.ts';
import { LISTS } from './src/lists.ts';
import { COMMON_SUFFIXES, GOOGLE_SUFFIXES } from './src/tlds.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = (...p) => join(here, ...p);
const out = root('dist');
const cache = root('filters/cache');
const cached = (url) => join(cache, basename(new URL(url).pathname));
const onByDefault = (feature) => DEFAULT_SETTINGS.blocking.lists[feature];
const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

// `google.*` can't be a Chrome match pattern, so it becomes one host per suffix; IP prefixes (`192.168.*`) can't be expanded.
// shortcut: Google's own domains, else a fixed list of common suffixes; a site on a rarer suffix keeps the generic CSS there.
function expandWildcard(host) {
  const base = host.slice(0, -2);
  if (!host.endsWith('.*') || base.includes('*') || /^[\d.]+$/.test(base)) return [];
  return (base.split('.').pop() === 'google' ? GOOGLE_SUFFIXES : COMMON_SUFFIXES).map((suffix) => `${base}.${suffix}`);
}
assert.ok(expandWildcard('www.google.*').includes('www.google.co.uk'));
assert.ok(expandWildcard('example.*').includes('example.com') && !expandWildcard('example.*').includes('example.co.ao'));
assert.deepEqual(expandWildcard('192.168.*'), []);
assert.deepEqual(expandWildcard('*.x.*'), []);
assert.deepEqual(expandWildcard('*.example.com'), []);

async function download(url) {
  let last;
  for (const [attempt, wait] of [0, 2_000, 5_000].entries()) {
    await sleep(wait);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trimStart().startsWith('[Adblock Plus')) throw new Error('the reply is not a filter list');
      writeFileSync(`${cached(url)}.part`, text);
      renameSync(`${cached(url)}.part`, cached(url));
      return;
    } catch (e) {
      last = e;
      console.warn(`Download ${attempt + 1} of 3 failed for ${url}: ${e.message}`);
    }
  }
  throw last;
}

mkdirSync(cache, { recursive: true });
const failed = [];
await Promise.all(
  FEATURES.flatMap((feature) =>
    (LISTS[feature].urls ?? []).map(async (url) => {
      if (existsSync(cached(url)) && !process.argv.includes('--refresh')) return;
      try {
        await download(url);
      } catch (e) {
        if (existsSync(cached(url))) console.warn(`Using the cached copy of ${url}.`);
        else failed.push(`${feature}: ${url} (${e.message})`);
      }
    }),
  ),
);
if (failed.length) {
  console.error(`Could not download these lists, and there is no cached copy:\n  ${failed.join('\n  ')}\nCheck the connection and run the build again.`);
  process.exit(1);
}

await checkRegexesWithRe2();
rmSync(out, { recursive: true, force: true });
for (const dir of ['rules', 'sources', 'cosmetic']) mkdirSync(join(out, dir), { recursive: true });

const meta = { builtAt: new Date().toISOString(), maxPriority: 0, features: {}, scriptlets: [] };
const rows = [];
const usedScriptlets = new Set();
for (const feature of FEATURES) {
  const list = LISTS[feature];
  const text = list.file ? readFileSync(root(list.file), 'utf8') : list.urls.map((url) => readFileSync(cached(url), 'utf8')).join('\n');
  const compiled = await compileFilters(stripSections(text, list.dropSections ?? []), { firstId: 1, regexLimit: 1000 });
  const { generic, ...cosmetic } = compiled.cosmetic;
  const unhiddenEverywhere = new Set(cosmetic.unhide['*'] ?? []);
  const genericCss = [...new Set(generic)].filter((s) => !unhiddenEverywhere.has(s));
  const dropped = { ...compiled.dropped };
  const drop = (reason) => (dropped[reason] = (dropped[reason] ?? 0) + 1);
  // Only hosts that actually change the generic CSS leave the registered stylesheet for the slower per-page path.
  const inGeneric = new Set(genericCss);
  const exempt = new Set([...cosmetic.generichide, ...cosmetic.elemhide]);
  for (const [host, selectors] of Object.entries(cosmetic.unhide)) if (selectors.some((s) => inGeneric.has(s))) exempt.add(host);
  exempt.delete('*');
  const genericExcept = new Set();
  let expanded = 0;
  for (const host of exempt) {
    let hosts = [host];
    if (host.includes('*')) {
      hosts = expandWildcard(host);
      expanded += hosts.length;
      if (!hosts.length) drop('wildcard-exception');
    }
    for (const h of hosts) {
      if (HOSTNAME.test(h)) genericExcept.add(h);
      else drop('invalid-exception-host');
    }
  }

  const ruleset = compiled.rules.length ? feature : null;
  if (ruleset) writeFileSync(join(out, 'rules', `${feature}.json`), JSON.stringify(compiled.rules));
  writeFileSync(join(out, 'sources', `${feature}.json`), JSON.stringify(compiled.sources));
  writeFileSync(join(out, 'cosmetic', `${feature}.json`), JSON.stringify(cosmetic));
  // One rule per selector: a selector Chrome can't parse voids only its own rule, not a whole group.
  if (genericCss.length) writeFileSync(join(out, 'cosmetic', `${feature}.generic.css`), genericCss.map((s) => `${s}{display:none!important}\n`).join(''));

  for (const calls of Object.values(cosmetic.scriptlets)) for (const call of calls) usedScriptlets.add(call.name);
  meta.maxPriority = Math.max(meta.maxPriority, compiled.maxPriority);
  meta.features[feature] = { ruleset, ruleCount: compiled.rules.length, hasGenericCss: genericCss.length > 0, genericExcept: [...genericExcept], allowIds: compiled.allowIds, modifyIds: compiled.modifyIds };
  const hosts = new Set([cosmetic.hide, cosmetic.unhide, cosmetic.scriptlets, cosmetic.scriptletExcept].flatMap(Object.keys).concat(cosmetic.generichide, cosmetic.elemhide));
  hosts.delete('*');
  const regex = compiled.rules.filter((r) => r.condition.regexFilter).length;
  const reasons = Object.entries(dropped).map(([reason, n]) => `${reason} ${n}`).join(', ') || '-';
  rows.push([feature, compiled.rules.length, regex, genericCss.length, hosts.size, genericExcept.size, expanded, compiled.errors.length, reasons]);
}

meta.scriptlets = [...usedScriptlets].sort();
const entries = meta.scriptlets.map((name) => `  ${JSON.stringify(name)}: ${scriptletFunction(name).toString()},\n`);
writeFileSync(join(out, 'scriptlets.js'), `// Generated from @adguard/scriptlets (GPL-3.0) by build.mjs.\nexport const SCRIPTLETS = {\n${entries.join('')}};\n`);
const { SCRIPTLETS } = await import(pathToFileURL(join(out, 'scriptlets.js')).href);
const broken = meta.scriptlets.filter((name) => typeof SCRIPTLETS[name] !== 'function');
if (broken.length) throw new Error(`scriptlets.js has no function for ${broken.join(', ')}`);

const manifest = JSON.parse(readFileSync(root('src/manifest.json'), 'utf8'));
manifest.declarative_net_request = {
  rule_resources: FEATURES.filter((f) => meta.features[f].ruleset).map((f) => ({ id: f, enabled: onByDefault(f), path: `rules/${f}.json` })),
};
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
writeFileSync(join(out, 'meta.json'), JSON.stringify(meta));

const table = [['feature', 'rules', 'regex rules', 'generic selectors', 'hosts', 'generic except', 'from wildcards', 'errors', 'dropped by reason'], ...rows].map((r) => r.map(String));
const widths = table[0].map((_, i) => Math.max(...table.map((r) => r[i].length)));
for (const r of table) console.log(r.map((cell, i) => (i === 0 || i === r.length - 1 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join('  ').trimEnd());
const total = FEATURES.reduce((n, f) => n + meta.features[f].ruleCount, 0);
const defaultOn = FEATURES.filter(onByDefault).reduce((n, f) => n + meta.features[f].ruleCount, 0);
console.log(`Rules: ${total} in all, ${defaultOn} in the lists that are on by default. Scriptlets: ${meta.scriptlets.length}.`);
if (defaultOn > 30_000) {
  console.warn(
    `Warning: the default lists have ${defaultOn} rules, more than the 30,000 Chrome guarantees. The rest come from a pool shared with your other extensions, so Chrome may leave a list off; check that the extension card shows no warning.`,
  );
}

await build({
  entryPoints: { background: root('src/background.ts'), popup: root('src/popup.ts'), options: root('src/options.ts'), devtools: root('src/devtools.ts'), panel: root('src/panel.ts') },
  bundle: true,
  format: 'esm',
  target: 'chrome128',
  outdir: out,
  external: ['./scriptlets.js'],
  logLevel: 'warning',
});
// Content scripts are classic scripts, not modules. The picker takes the shared UI styles as text and adopts them into its shadow root.
await build({
  entryPoints: { 'notify-deny': root('src/notify-deny.ts'), picker: root('src/picker.ts'), 'yt-main': root('src/yt-main.ts'), 'yt-relay': root('src/yt-relay.ts') },
  bundle: true,
  format: 'iife',
  target: 'chrome128',
  outdir: out,
  loader: { '.css': 'text' },
  logLevel: 'warning',
});
const ui = root('../../packages/ui');
for (const f of ['popup.html', 'popup.css', 'options.html', 'options.css', 'switch.css', 'devtools.html', 'panel.html', 'panel.css']) cpSync(root('src', f), join(out, f));
for (const f of ['tokens.css', 'base.css']) cpSync(join(ui, 'web', f), join(out, 'web', f));
cpSync(join(ui, 'fonts'), join(out, 'fonts'), { recursive: true });
for (const size of [16, 32, 48, 128]) cpSync(root(`assets/icon-${size}.png`), join(out, `icon-${size}.png`));
console.log('Built', out);
