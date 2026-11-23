import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { decideTarget, LINK_PERMISSION, SIBLING_PACKAGES } from '../index.ts';

const pkg = path.resolve(import.meta.dirname, '../..');
const repo = path.resolve(pkg, '../..');
const read = (rel: string) => fs.readFileSync(path.join(pkg, rel), 'utf8');
const fixture = JSON.parse(read('fixtures/sibling-packages.json')) as Record<string, string>;
const cases: { case: string; expectedPackage: string; resolvedPackage: string | null; signaturesMatch: boolean; trust: string; reason: string }[] = JSON.parse(
  read('fixtures/target-decisions.json'),
);
const kotlin = read('android/AppLinkTarget.kt');

const APP_DIRS: Record<string, string> = {
  netlens: 'netlens',
  'open-tunnel': 'open_tunnel_vpn',
  deputy: 'deputy',
  strongroom: 'strongroom',
  inflow: 'inflow',
  'pdf-editor': 'pdf-editor-mobile',
  clipboard: 'clipboard',
  halo: 'halo',
  'design-editor': 'design-editor-mobile',
  'ai-hub': 'ai-hub',
};

test('decideTarget matches every row of target-decisions.json', () => {
  const kinds = new Set(cases.map((c) => c.reason));
  for (const r of ['ok', 'not-installed', 'unknown-sibling', 'wrong-package', 'signature-mismatch']) assert.ok(kinds.has(r), `no ${r} row`);
  for (const c of cases) assert.deepEqual(decideTarget(c.expectedPackage, c.resolvedPackage, c.signaturesMatch), { trust: c.trust, reason: c.reason }, c.case);
});

test('decideTarget fails closed on odd input', () => {
  const loose = decideTarget as (e: unknown, r: unknown, s: unknown) => { trust: string };
  for (const [e, r, s] of [[undefined, 'com.haroon.inflow', true], [null, null, true], ['com.haroon.inflow', 5, true], ['com.haroon.inflow', 'com.haroon.inflow', 'yes'], ['com.haroon.inflow', 'com.haroon.inflow', 1], ['toString', 'toString', true]]) {
    assert.notEqual(loose(e, r, s).trust, 'trusted', JSON.stringify([e, r, s]));
  }
});

test('SIBLING_PACKAGES equals the fixture', () => assert.deepEqual({ ...SIBLING_PACKAGES }, fixture));

test('SiblingPackages in AppLinkTarget.kt equals the fixture', () => {
  const consts = Object.fromEntries([...kotlin.matchAll(/const val ([A-Z_]+) = "([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const all = Object.fromEntries([...kotlin.matchAll(/^\s*"([a-z-]+)" to ([A-Z_]+),$/gm)].map((m) => [m[1], consts[m[2]]]));
  assert.deepEqual(all, fixture);
  assert.equal(consts.LINK_PERMISSION, LINK_PERMISSION);
});

test('every sibling package equals the Store table and the app build.gradle applicationId', () => {
  const store = fs.readFileSync(path.join(repo, 'packages/store-manifest/src/index.ts'), 'utf8');
  const table = store.slice(store.indexOf('export const ANDROID_PACKAGES'), store.indexOf('} as const', store.indexOf('export const ANDROID_PACKAGES')));
  const storePackages = Object.fromEntries([...table.matchAll(/^\s*'?([a-z-]+)'?: '([^']+)',$/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual(Object.keys(APP_DIRS).sort(), Object.keys(fixture).sort());
  for (const [id, name] of Object.entries(fixture)) {
    assert.equal(storePackages[id], name, `ANDROID_PACKAGES.${id}`);
    const gradle = fs.readFileSync(path.join(repo, 'apps', APP_DIRS[id], 'android/app/build.gradle'), 'utf8');
    assert.equal(/applicationId '([^']+)'/.exec(gradle)?.[1], name, `apps/${APP_DIRS[id]} applicationId`);
  }
});
