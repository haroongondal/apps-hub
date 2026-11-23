import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repo = path.resolve(import.meta.dirname, '../../../..');
const canonicalDir = path.join(repo, 'packages/app-link-contract/android');
const FILES = ['AppLinkGuard.kt', 'AppLinkCaller.kt'];
const OBJECT = /^object (AppLinkGuard|AppLinkCaller)\b/m;
const PACKAGE_LINE = /^package [a-z][\w.]*$/;
const SKIP = new Set(['node_modules', 'build', '.git', '.gradle', '.cxx', '.worktrees']);

/** Every .kt under `dir` whose content declares one of the guard objects, whatever the file is called or where it sits. */
function walk(dir: string, out: string[]) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.kt') && OBJECT.test(fs.readFileSync(full, 'utf8'))) out.push(full);
  }
}

/** Why `copy` (a file called `fileName`) is not a faithful copy of `canonical`; empty when it is. Only the `package` line may differ. */
function copyProblems(canonical: string, copy: string, fileName: string): string[] {
  const kind = OBJECT.exec(copy)![1];
  const problems: string[] = [];
  if (fileName !== `${kind}.kt`) problems.push(`file is named ${fileName}, expected ${kind}.kt`);
  const lines = copy.split('\n');
  const packages = lines.filter((l) => /^package\b/.test(l));
  if (packages.length !== 1) problems.push(`needs exactly one package line, has ${packages.length}`);
  else if (!PACKAGE_LINE.test(packages[0])) problems.push(`package line is not just a package name: ${JSON.stringify(packages[0])}`);
  const rest = (text: string) => text.split('\n').filter((l) => !/^package\b/.test(l)).join('\n');
  if (rest(copy) !== rest(canonical)) problems.push('differs from the canonical file outside its package line');
  return problems;
}

const canonical = (f: string) => fs.readFileSync(path.join(canonicalDir, f), 'utf8');

test('the canonical files use package applink', () => {
  for (const f of FILES) assert.match(canonical(f), /^package applink$/m, f);
});

test('copyProblems accepts a good copy and names every kind of bad one', () => {
  const guard = canonical('AppLinkGuard.kt');
  const swap = (line: string) => guard.replace('package applink', line);
  assert.deepEqual(copyProblems(guard, swap('package expo.modules.x.applink'), 'AppLinkGuard.kt'), []);
  assert.match(copyProblems(guard, swap('package a.b; fun evil() {}'), 'AppLinkGuard.kt').join(), /not just a package name/);
  assert.match(copyProblems(guard, swap('package a.b // x'), 'AppLinkGuard.kt').join(), /not just a package name/);
  assert.match(copyProblems(guard, swap('package a.b\npackage c.d'), 'AppLinkGuard.kt').join(), /exactly one package line/);
  assert.match(copyProblems(guard, guard.replace('package applink\n', ''), 'AppLinkGuard.kt').join(), /exactly one package line/);
  assert.match(copyProblems(guard, guard, 'Guard.kt').join(), /expected AppLinkGuard\.kt/);
  assert.match(copyProblems(guard, guard.replace('MAX_EXTRAS = 8', 'MAX_EXTRAS = 80'), 'AppLinkGuard.kt').join(), /differs from the canonical/);
  const caller = canonical('AppLinkCaller.kt');
  assert.match(copyProblems(caller, guard, 'AppLinkCaller.kt').join(), /expected AppLinkGuard\.kt/);
});

const copies: string[] = [];
walk(path.join(repo, 'apps'), copies);

test('Inflow carries a copy of each canonical file', () => {
  for (const f of FILES) assert.ok(copies.some((c) => c.includes(`${path.sep}inflow${path.sep}`) && path.basename(c) === f), `no Inflow copy of ${f}`);
});

test('every copy under apps/ (found by content) equals the canonical file apart from its package line', () => {
  for (const copy of copies) {
    const kind = OBJECT.exec(fs.readFileSync(copy, 'utf8'))![1];
    assert.deepEqual(copyProblems(canonical(`${kind}.kt`), fs.readFileSync(copy, 'utf8'), path.basename(copy)), [], path.relative(repo, copy));
  }
});
