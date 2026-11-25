import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { APPS } from '../apps.ts';
import { SCHEMAS, checkSchemas, countSteps, readVersion, type SchemaSource } from '../schemas.ts';

const ROOT = resolve(import.meta.dirname, '../../../..');

describe('schema registry', () => {
  it('has an entry (possibly empty) for every releasable app and nothing else', () => {
    assert.deepEqual(Object.keys(SCHEMAS).sort(), Object.keys(APPS).sort());
  });

  it('matches the version each source file declares today', () => {
    for (const [id, sources] of Object.entries(SCHEMAS)) {
      for (const s of sources) {
        if (s.kind === 'unversioned') continue;
        assert.equal(readVersion(readFileSync(join(ROOT, s.file), 'utf8'), s), s.version, `${id}: ${s.db} (${s.file}); update tools/release/src/schemas.ts`);
      }
    }
  });

  it('lists every file in the repo that declares or opens a database', () => {
    const declares = /SQLiteOpenHelper\(|PRAGMA user_version\s*=|SCHEMA_VERSION\s*=|\bDB_VERSION\s*=|export const \w+_STEPS: readonly string\[\]|openDatabaseAsync\(|openOrCreateDatabase\(/;
    const skip = /node_modules|\/__tests__\/|\/test\/|\.test\.|^apps\/(autonomous-browsing|sieve|strongroom-extension|pdf-editor-desktop|design-editor)\//;
    const known = new Set(Object.values(SCHEMAS).flat().map((s) => s.file));
    const files = execFileSync('git', ['ls-files', 'apps', 'packages'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((f) => /\.(kt|java|swift|ts|tsx)$/.test(f) && !skip.test(f));
    const missing = files.filter((f) => declares.test(readFileSync(join(ROOT, f), 'utf8')) && !known.has(f));
    assert.deepEqual(missing, [], 'a new database or schema declaration: register it in tools/release/src/schemas.ts');
  });
});

describe('countSteps', () => {
  it('counts string literals, ignoring comments, escapes and brackets inside them', () => {
    const text = 'export const STEPS: readonly string[] = [\n  // note ] "x"\n  `a [ ] \\` b`,\n  "c",\n  /* ] */ \'d\',\n];\nconst OTHER = ["z"];';
    assert.equal(countSteps(text, 'STEPS'), 3);
    assert.equal(countSteps(text, 'OTHER'), 1);
    assert.equal(countSteps(text, 'MISSING'), null);
    assert.equal(countSteps('const STEPS = [`a`', 'STEPS'), null);
  });
});

describe('readVersion', () => {
  const pragma: SchemaSource = { kind: 'const', db: 'd', file: 'f', pattern: /PRAGMA user_version = (\d+)/g, version: 0 };
  it('takes the highest match and null when nothing matches', () => {
    assert.equal(readVersion('PRAGMA user_version = 1; PRAGMA user_version = 2', pragma), 2);
    assert.equal(readVersion('nothing', pragma), null);
  });
});

const tmp = mkdtempSync(join(tmpdir(), 'release-schemas-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e.com' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' }).trim();

const CLIP = (SCHEMAS.clipboard[0] as Extract<SchemaSource, { kind: 'const' }>).file;
const clipSource = (v: number) => `class ClipStore : SQLiteOpenHelper(context, "clips.db", null, ${v}) {}\n`;
function commit(repo: string, files: Record<string, string>): string {
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(join(repo, f, '..'), { recursive: true });
    writeFileSync(join(repo, f), text);
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-m', 'c');
  return git(repo, 'rev-parse', 'HEAD');
}

describe('checkSchemas', () => {
  const repo = join(tmp, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-b', 'main');
  const v1 = commit(repo, { [CLIP]: clipSource(1) });
  const v2 = commit(repo, { [CLIP]: clipSource(2) });
  const renamed = commit(repo, { [CLIP]: 'class ClipStore { val db = Helper("clips.db") }\n' });
  const none = commit(repo, { [CLIP]: '', [`${CLIP}.gone`]: 'x' });
  git(repo, 'rm', '-q', CLIP, `${CLIP}.gone`);
  git(repo, 'commit', '-m', 'drop');
  const dropped = git(repo, 'rev-parse', 'HEAD');

  it('flags a target whose schema is older than the one it would replace', () => {
    assert.deepEqual(checkSchemas(repo, 'clipboard', v1, [v2]), [{ app: 'clipboard', db: 'clips.db', target: 1, current: 2, verdict: 'newer' }]);
  });

  it('passes an equal schema, and a target that never had the database', () => {
    assert.equal(checkSchemas(repo, 'clipboard', v2, [v2])[0].verdict, 'ok');
    assert.deepEqual(checkSchemas(repo, 'clipboard', dropped, [v2])[0], { app: 'clipboard', db: 'clips.db', target: null, current: 2, verdict: 'ok' });
  });

  it('cannot rule out a file whose constant is no longer readable', () => {
    assert.equal(checkSchemas(repo, 'clipboard', renamed, [v2])[0].verdict, 'unknown');
    assert.equal(checkSchemas(repo, 'clipboard', v1, [renamed])[0].verdict, 'unknown');
    assert.equal(checkSchemas(repo, 'clipboard', none, [v2])[0].verdict, 'unknown');
  });

  it('a registered file missing at the target while the app exists there is unknown, not "never had it"', () => {
    const moved = join(tmp, 'moved');
    mkdirSync(moved);
    git(moved, 'init', '-b', 'main');
    const before = commit(moved, { [CLIP.replace('/android/src/main/java', '/android/src/main/kotlin')]: clipSource(1), 'apps/clipboard/App.tsx': 'x' });
    const after = commit(moved, { [CLIP]: clipSource(2) });
    git(moved, 'rm', '-q', CLIP.replace('/android/src/main/java', '/android/src/main/kotlin'));
    git(moved, 'commit', '-m', 'move');
    const check = checkSchemas(moved, 'clipboard', before, [git(moved, 'rev-parse', 'HEAD')]);
    assert.equal(check[0].verdict, 'unknown');
    assert.equal(after.length, 40);
  });

  it('takes the highest schema of several commits, and says unknown when the commits cannot be named or are only a guess', () => {
    assert.equal(checkSchemas(repo, 'clipboard', v2, [v1, v2])[0].verdict, 'ok');
    assert.deepEqual(checkSchemas(repo, 'clipboard', v1, [v1, v2])[0], { app: 'clipboard', db: 'clips.db', target: 1, current: 2, verdict: 'newer' });
    assert.equal(checkSchemas(repo, 'clipboard', v2, null)[0].verdict, 'unknown');
    assert.equal(checkSchemas(repo, 'clipboard', v1, [v2], false)[0].verdict, 'unknown');
    assert.equal(checkSchemas(repo, 'clipboard', v2, [v2], false)[0].verdict, 'ok');
  });

  it('has nothing to check for an app without a database or an unknown id', () => {
    assert.deepEqual(checkSchemas(repo, 'deputy', v1, [v2]), []);
    assert.deepEqual(checkSchemas(repo, 'nope', v1, [v2]), []);
  });

  it('reads the real tree: every registered database is readable at HEAD', () => {
    for (const id of Object.keys(SCHEMAS)) for (const c of checkSchemas(ROOT, id, 'HEAD', ['HEAD'])) assert.equal(c.verdict, 'ok', `${id} ${c.db}`);
  });
});
