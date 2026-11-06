import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scriptlets } from '@adguard/scriptlets';
import { DEFAULT_SETTINGS, FEATURES, compileFilters, stripSections } from '@apps-hub/sieve-core';
import { checkRegexesWithRe2 } from '@apps-hub/sieve-core/src/node-regex.ts';
import { LISTS } from './src/lists.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = (...p) => join(here, ...p);
const out = root('dist');
const cache = root('filters/cache');
const cached = (url) => join(cache, basename(new URL(url).pathname));
const onByDefault = (feature) => DEFAULT_SETTINGS.blocking.lists[feature];

async function download(url) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
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
      console.warn(`Download ${attempt} of 3 failed for ${url}: ${e.message}`);
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
  const genericExcept = [...new Set([...Object.keys(cosmetic.unhide), ...cosmetic.generichide, ...cosmetic.elemhide])].filter((host) => {
    if (host === '*') return false;
    // `google.*` can't be a Chrome match pattern, so those sites keep the generic CSS.
    if (!host.includes('*')) return true;
    dropped['wildcard-exception'] = (dropped['wildcard-exception'] ?? 0) + 1;
    return false;
  });

  const ruleset = compiled.rules.length ? feature : null;
  if (ruleset) writeFileSync(join(out, 'rules', `${feature}.json`), JSON.stringify(compiled.rules));
  writeFileSync(join(out, 'sources', `${feature}.json`), JSON.stringify(compiled.sources));
  writeFileSync(join(out, 'cosmetic', `${feature}.json`), JSON.stringify(cosmetic));
  // One rule per selector: a selector Chrome can't parse voids only its own rule, not a whole group.
  if (genericCss.length) writeFileSync(join(out, 'cosmetic', `${feature}.generic.css`), genericCss.map((s) => `${s}{display:none!important}\n`).join(''));

  for (const calls of Object.values(cosmetic.scriptlets)) for (const call of calls) usedScriptlets.add(call.name);
  meta.maxPriority = Math.max(meta.maxPriority, compiled.maxPriority);
  meta.features[feature] = { ruleset, ruleCount: compiled.rules.length, hasGenericCss: genericCss.length > 0, genericExcept, allowIds: compiled.allowIds };
  const hosts = new Set([cosmetic.hide, cosmetic.unhide, cosmetic.scriptlets, cosmetic.scriptletExcept].flatMap(Object.keys).concat(cosmetic.generichide, cosmetic.elemhide));
  hosts.delete('*');
  const regex = compiled.rules.filter((r) => r.condition.regexFilter).length;
  const reasons = Object.entries(dropped).map(([reason, n]) => `${reason} ${n}`).join(', ') || '-';
  rows.push([feature, compiled.rules.length, regex, genericCss.length, hosts.size, compiled.errors.length, reasons]);
}

meta.scriptlets = [...usedScriptlets].sort();
const entries = meta.scriptlets.map((name) => `  ${JSON.stringify(name)}: ${scriptlets.getScriptletFunction(name).toString()},\n`);
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

const table = [['feature', 'rules', 'regex rules', 'generic selectors', 'hosts', 'errors', 'dropped by reason'], ...rows].map((r) => r.map(String));
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
  entryPoints: { background: root('src/background.ts') },
  bundle: true,
  format: 'esm',
  target: 'chrome127',
  outdir: out,
  external: ['./scriptlets.js'],
  logLevel: 'warning',
});
const ui = root('../../packages/ui');
for (const f of ['tokens.css', 'base.css']) cpSync(join(ui, 'web', f), join(out, 'web', f));
cpSync(join(ui, 'fonts'), join(out, 'fonts'), { recursive: true });
for (const size of [16, 32, 48, 128]) cpSync(root(`assets/icon-${size}.png`), join(out, `icon-${size}.png`));
console.log('Built', out);
