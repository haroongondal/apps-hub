import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repo = path.resolve(import.meta.dirname, '../../../..');
const canonicalDir = path.join(repo, 'packages/app-link-contract/android');
const FILES = ['AppLinkGuard.kt', 'AppLinkCaller.kt'];
const SKIP = new Set(['node_modules', 'build', '.git', '.gradle', '.worktrees']);

function walk(dir: string, out: string[]) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (FILES.includes(e.name)) out.push(full);
  }
}

// Only the single `package` line may differ between the canonical file and an app's copy.
const withoutPackage = (file: string) => {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  assert.equal(lines.filter((l) => l.startsWith('package ')).length, 1, `${file} needs exactly one package line`);
  return lines.filter((l) => !l.startsWith('package ')).join('\n');
};

const copies: string[] = [];
for (const app of fs.readdirSync(path.join(repo, 'apps'))) {
  const modules = path.join(repo, 'apps', app, 'modules');
  if (!fs.existsSync(modules)) continue;
  for (const mod of fs.readdirSync(modules)) {
    const main = path.join(modules, mod, 'android/src/main');
    if (fs.existsSync(main)) walk(main, copies);
  }
}

test('the canonical files use package applink', () => {
  for (const f of FILES) assert.match(fs.readFileSync(path.join(canonicalDir, f), 'utf8'), /^package applink$/m, f);
});

test('Inflow carries a copy of each canonical file', () => {
  for (const f of FILES) assert.ok(copies.some((c) => c.includes(`${path.sep}inflow${path.sep}`) && path.basename(c) === f), `no Inflow copy of ${f}`);
});

test('every copy equals the canonical file apart from its package line', () => {
  for (const copy of copies) {
    assert.equal(withoutPackage(copy), withoutPackage(path.join(canonicalDir, path.basename(copy))), path.relative(repo, copy));
  }
});
