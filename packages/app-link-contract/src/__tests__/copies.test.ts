import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repo = path.resolve(import.meta.dirname, '../../../..');
const canonicalDir = path.join(repo, 'packages/app-link-contract/android');
const FILES = ['AppLinkGuard.kt', 'AppLinkCaller.kt', 'AppLinkActivityCaller.kt', 'AppLinkTarget.kt', 'AppLinkTargetTest.kt'];
// Inflow serves a share and an action (ADD_TODO) and reads and starts siblings, so it carries the provider guard, the activity check and the target check; the activity check is copied in only by apps with a link action.
const INFLOW_FILES = ['AppLinkGuard.kt', 'AppLinkCaller.kt', 'AppLinkActivityCaller.kt', 'AppLinkTarget.kt', 'AppLinkTargetTest.kt'];
// Modifiers and indentation are allowed, so `internal object AppLinkGuard` is still found (and then reported as differing).
const OBJECT = /^\s*(?:\w+\s+)*(?:object|class) (AppLinkGuard|AppLinkCaller|AppLinkActivityCaller|AppLinkTarget|SiblingPackages|AppLinkTargetTest)\b/m;
// SiblingPackages lives in AppLinkTarget.kt, so a copy of it anywhere is checked against that file.
const KIND_FILE: Record<string, string> = { SiblingPackages: 'AppLinkTarget' };
const kindOf = (text: string, fileName: string) => KIND_FILE[OBJECT.exec(text)?.[1] ?? ''] ?? OBJECT.exec(text)?.[1] ?? fileName.replace(/\.kt$/, '');
const PACKAGE_LINE = /^package [a-z][\w.]*$/;
const SKIP = new Set(['node_modules', 'build', '.git', '.gradle', '.cxx', '.worktrees']);

/** Every .kt under `dir` named like a canonical file or whose content declares one of the guard objects, wherever it sits. */
function walk(dir: string, out: string[]) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.kt') && (FILES.includes(e.name) || OBJECT.test(fs.readFileSync(full, 'utf8')))) out.push(full);
  }
}

/** Why `copy` (a file called `fileName`) is not a faithful copy of `canonical`; empty when it is. Only the `package` line may differ. */
function copyProblems(canonical: string, copy: string, fileName: string): string[] {
  const kind = kindOf(copy, fileName);
  const declaration = kind.endsWith('Test') ? 'class' : 'object';
  const problems: string[] = [];
  if (fileName !== `${kind}.kt`) problems.push(`file is named ${fileName}, expected ${kind}.kt`);
  if (!new RegExp(`^${declaration} ${kind}\\b`, 'm').test(copy)) problems.push(`has no plain \`${declaration} ${kind}\` declaration`);
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
  assert.match(copyProblems(guard, guard.replace('object AppLinkGuard', 'internal object AppLinkGuard'), 'AppLinkGuard.kt').join(), /no plain `object AppLinkGuard`.*differs from the canonical/);
  assert.match(copyProblems(guard, guard.replace('object AppLinkGuard', '  public object AppLinkGuard'), 'AppLinkGuard.kt').join(), /differs from the canonical/);
  assert.match(copyProblems(guard, guard.replace('object AppLinkGuard', 'class AppLinkGuardX'), 'AppLinkGuard.kt').join(), /no plain `object AppLinkGuard`/);
  const caller = canonical('AppLinkCaller.kt');
  assert.match(copyProblems(caller, guard, 'AppLinkCaller.kt').join(), /expected AppLinkGuard\.kt/);
  const activity = canonical('AppLinkActivityCaller.kt');
  const moved = activity.replace('package applink', 'package expo.modules.deputyagent.applink');
  assert.deepEqual(copyProblems(activity, moved, 'AppLinkActivityCaller.kt'), []);
  assert.match(copyProblems(activity, moved.replace('&& signaturesMatch', '|| signaturesMatch'), 'AppLinkActivityCaller.kt').join(), /differs from the canonical/);
  assert.match(copyProblems(activity, moved, 'AppLinkCaller.kt').join(), /expected AppLinkActivityCaller\.kt/);
  const target = canonical('AppLinkTarget.kt');
  const targetCopy = target.replace('package applink', 'package expo.modules.halo.applink');
  assert.deepEqual(copyProblems(target, targetCopy, 'AppLinkTarget.kt'), []);
  assert.match(copyProblems(target, targetCopy.replace('resolvedPackage != expectedPackage', 'resolvedPackage == null'), 'AppLinkTarget.kt').join(), /differs from the canonical/);
  assert.match(copyProblems(target, targetCopy.replace('"com.haroon.inflow"', '"com.evil.inflow"'), 'AppLinkTarget.kt').join(), /differs from the canonical/);
  assert.match(copyProblems(target, 'package x\nobject SiblingPackages {}\n', 'Siblings.kt').join(), /expected AppLinkTarget\.kt.*differs from the canonical/);
  const testFile = canonical('AppLinkTargetTest.kt');
  const testCopy = testFile.replace('package applink', 'package expo.modules.halo.applink');
  assert.deepEqual(copyProblems(testFile, testCopy, 'AppLinkTargetTest.kt'), []);
  assert.match(copyProblems(testFile, testCopy.replace('cases.size >= 12', 'cases.size >= 0'), 'AppLinkTargetTest.kt').join(), /differs from the canonical/);
});

test('walk includes a file named like a canonical one even when its object line is altered', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copies-'));
  try {
    fs.mkdirSync(path.join(dir, 'a'));
    fs.writeFileSync(path.join(dir, 'a/AppLinkGuard.kt'), 'package x\nclass Renamed\n');
    fs.writeFileSync(path.join(dir, 'a/Other.kt'), 'package x\ninternal object AppLinkCaller {}\n');
    fs.writeFileSync(path.join(dir, 'a/Unrelated.kt'), 'package x\nobject Something\n');
    fs.writeFileSync(path.join(dir, 'a/AppLinkActivityCaller.kt'), 'package x\nclass Renamed\n');
    fs.writeFileSync(path.join(dir, 'a/Gate.kt'), 'package x\n  object AppLinkActivityCaller {}\n');
    const found: string[] = [];
    walk(dir, found);
    assert.deepEqual(found.map((f) => path.basename(f)).sort(), ['AppLinkActivityCaller.kt', 'AppLinkGuard.kt', 'Gate.kt', 'Other.kt']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const copies: string[] = [];
walk(path.join(repo, 'apps'), copies);

test('Inflow carries a copy of each canonical file', () => {
  for (const f of INFLOW_FILES) assert.ok(copies.some((c) => c.includes(`${path.sep}inflow${path.sep}`) && path.basename(c) === f), `no Inflow copy of ${f}`);
});

test('every copy under apps/ (found by content) equals the canonical file apart from its package line', () => {
  for (const copy of copies) {
    const text = fs.readFileSync(copy, 'utf8');
    const kind = kindOf(text, path.basename(copy));
    assert.deepEqual(copyProblems(canonical(`${kind}.kt`), text, path.basename(copy)), [], path.relative(repo, copy));
  }
});
