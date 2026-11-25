import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { SIGNING_CERT_SHA256, emptyManifest, upsertAndroidRelease, type AndroidRelease, type StoreManifest } from '@apps-hub/store-manifest';
import { androidEntry, assertVersionStillFree, releaseAndroid } from '../release-android.ts';
import { blockingSchemas, formatPlan, gateRollback, planRollback, rollbackFlagError, rolledBackFrom, storeTarget, withWorktree, type RollbackPlan } from '../rollback.ts';

const tmp = mkdtempSync(join(tmpdir(), 'release-rollback-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
};
Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' });
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' }).trim();

const APP_DIR = 'apps/netlens'; // the real registry entry the planner looks up
function commitVersion(dir: string, version: string): string {
  mkdirSync(join(dir, APP_DIR), { recursive: true });
  writeFileSync(join(dir, APP_DIR, 'app.json'), JSON.stringify({ expo: { version } }));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', `app ${version}`);
  return git(dir, 'rev-parse', 'HEAD');
}

let n = 0;
/** origin + clone on main with three pushed commits (app versions 0.1.0, 0.2.0, 0.3.0). */
function fixture() {
  const root = join(tmp, String(n++));
  const origin = join(root, 'origin.git');
  const clone = join(root, 'clone');
  mkdirSync(root);
  git(root, 'init', '--bare', '-b', 'main', origin);
  git(root, 'clone', origin, clone);
  git(clone, 'checkout', '-B', 'main');
  const c1 = commitVersion(clone, '0.1.0');
  const c2 = commitVersion(clone, '0.2.0');
  const c3 = commitVersion(clone, '0.3.0');
  git(clone, 'push', 'origin', 'main');
  return { root, origin, clone, c1, c2, c3 };
}

const release = (versionCode: number, commit?: string): AndroidRelease => ({
  packageName: 'app.netlens',
  versionCode,
  versionName: '0.3.0',
  minSdk: 24,
  apkPath: `apps/netlens/android/${versionCode}.apk`,
  sha256: 'a'.repeat(64),
  signingCertSha256: SIGNING_CERT_SHA256,
  sizeBytes: 1000,
  ...(commit ? { commit } : {}),
});
const published = (versionCode: number, commit?: string): StoreManifest =>
  upsertAndroidRelease(emptyManifest(), { id: 'netlens', name: 'HomeNet', changelog: '' }, release(versionCode, commit));

describe('planRollback', () => {
  it('defaults to the first parent of the current release commit and takes a versionCode above the published one', () => {
    const { clone, c2, c3 } = fixture();
    const plan = planRollback({ repoDir: clone, id: 'netlens', manifest: published(41, c3) });
    assert.equal(plan.toCommit, c2);
    assert.equal(plan.fromCommit, c3);
    assert.equal(plan.toVersionName, '0.2.0'); // the old commit's own app.json is lower than what is published
    assert.equal(plan.newVersionCode, 42);
    assert.ok(plan.newVersionCode > plan.fromVersionCode);
    assert.equal(plan.changelog, `Rollback to 0.2.0 (${c2.slice(0, 7)})`);
  });

  it('targets before the app\'s last change when the release commit itself only touched another folder', () => {
    const { clone, c2, c3 } = fixture();
    writeFileSync(join(clone, 'README'), 'other work');
    git(clone, 'add', 'README');
    git(clone, 'commit', '-m', 'unrelated');
    const c4 = git(clone, 'rev-parse', 'HEAD');
    git(clone, 'push', 'origin', 'main');
    const plan = planRollback({ repoDir: clone, id: 'netlens', manifest: published(41, c4) });
    assert.equal(plan.toCommit, c2); // the app as before c3, its last change; a plain first parent would give c3
    assert.notEqual(plan.toCommit, c3);
  });

  it('refuses --to when the app folder is identical to the current release', () => {
    const { clone, c3 } = fixture();
    writeFileSync(join(clone, 'README'), 'other work');
    git(clone, 'add', 'README');
    git(clone, 'commit', '-m', 'unrelated');
    const c4 = git(clone, 'rev-parse', 'HEAD');
    git(clone, 'push', 'origin', 'main');
    assert.throws(() => planRollback({ repoDir: clone, id: 'netlens', manifest: published(41, c4), to: c3 }), /nothing to roll back/);
  });

  it('--to resolves a full sha, a short sha and a tag, and may skip several releases', () => {
    const { clone, c1, c3 } = fixture();
    const manifest = published(7, c3);
    assert.equal(planRollback({ repoDir: clone, id: 'netlens', manifest, to: c1 }).toCommit, c1);
    assert.equal(planRollback({ repoDir: clone, id: 'netlens', manifest, to: c1.slice(0, 8) }).toCommit, c1);
    git(clone, 'tag', 'v0.1', c1);
    assert.equal(planRollback({ repoDir: clone, id: 'netlens', manifest, to: 'v0.1' }).toCommit, c1);
  });

  it('--to works when the current entry has no commit recorded', () => {
    const { clone, c2 } = fixture();
    const plan = planRollback({ repoDir: clone, id: 'netlens', manifest: published(5), to: c2 });
    assert.equal(plan.fromCommit, undefined);
    assert.equal(plan.toCommit, c2);
  });

  it('refuses without a commit on the entry and no --to', () => {
    const { clone } = fixture();
    assert.throws(() => planRollback({ repoDir: clone, id: 'netlens', manifest: published(5) }), /no commit recorded.*--to/);
  });

  it('refuses when the app has no published release', () => {
    const { clone } = fixture();
    assert.throws(() => planRollback({ repoDir: clone, id: 'netlens', manifest: emptyManifest() }), /no published release/);
  });

  it('refuses when the target is the current release commit', () => {
    const { clone, c3 } = fixture();
    assert.throws(() => planRollback({ repoDir: clone, id: 'netlens', manifest: published(5, c3), to: c3 }), /is the current release/);
  });

  it('refuses a target that is not on origin/main', () => {
    const { clone, c3 } = fixture();
    git(clone, 'checkout', '-b', 'feature', 'HEAD~2');
    const off = commitVersion(clone, '9.9.9');
    assert.throws(() => planRollback({ repoDir: clone, id: 'netlens', manifest: published(5, c3), to: off }), /not on origin\/main/);
  });

  it('refuses a target newer than the current release', () => {
    const { clone, c2, c3 } = fixture();
    assert.throws(() => planRollback({ repoDir: clone, id: 'netlens', manifest: published(5, c2), to: c3 }), /newer than the current release/);
  });

  it('refuses an unknown --to and a target where the app does not exist', () => {
    const { clone, c3 } = fixture();
    assert.throws(() => planRollback({ repoDir: clone, id: 'netlens', manifest: published(5, c3), to: 'nope' }), /no such commit/);
  });

  it('refuses a target from before the app existed', () => {
    const root = join(tmp, `early${n++}`);
    const origin = join(root, 'origin.git');
    const clone = join(root, 'clone');
    mkdirSync(root);
    git(root, 'init', '--bare', '-b', 'main', origin);
    git(root, 'clone', origin, clone);
    git(clone, 'checkout', '-B', 'main');
    writeFileSync(join(clone, 'README'), 'x');
    git(clone, 'add', 'README');
    git(clone, 'commit', '-m', 'readme');
    const early = git(clone, 'rev-parse', 'HEAD');
    commitVersion(clone, '0.1.0');
    const cur = commitVersion(clone, '0.2.0');
    git(clone, 'push', 'origin', 'main');
    assert.throws(() => planRollback({ repoDir: clone, id: 'netlens', manifest: published(5, cur), to: early }), /app is not in that commit/);
  });

  it('refuses a current release commit that is a root commit (no previous release)', () => {
    const root = join(tmp, `root${n++}`);
    const origin = join(root, 'origin.git');
    const clone = join(root, 'clone');
    mkdirSync(root);
    git(root, 'init', '--bare', '-b', 'main', origin);
    git(root, 'clone', origin, clone);
    git(clone, 'checkout', '-B', 'main');
    const only = commitVersion(clone, '0.1.0');
    git(clone, 'push', 'origin', 'main');
    assert.throws(() => planRollback({ repoDir: clone, id: 'netlens', manifest: published(2, only) }), /no parent/);
  });
});

describe('dry run', () => {
  it('plan output has the five lines, and planning itself creates no worktree', () => {
    const { clone, c2, c3 } = fixture();
    const before = git(clone, 'worktree', 'list');
    const plan = planRollback({ repoDir: clone, id: 'netlens', manifest: published(41, c3) });
    const out = formatPlan(plan, storeTarget('https://store.example.workers.dev/'));
    assert.match(out, /^app: netlens$/m);
    assert.ok(out.includes(`from: ${c3} (versionCode 41)`));
    assert.ok(out.includes(`to commit: ${c2}`));
    assert.match(out, /^new versionCode: 42$/m);
    assert.match(out, /^target: store\.example\.workers\.dev$/m);
    assert.equal(git(clone, 'worktree', 'list'), before);
  });

  it('target falls back to "Store" without a usable URL', () => {
    assert.equal(storeTarget(undefined), 'Store');
    assert.equal(storeTarget('not a url'), 'Store');
  });
});

describe('withWorktree', () => {
  it('checks out the sha in a separate tree and removes it afterwards, also when the callback throws', async () => {
    const { clone, c1 } = fixture();
    const before = git(clone, 'worktree', 'list');
    let seen = '';
    await withWorktree(clone, c1, async (dir) => {
      seen = git(dir, 'rev-parse', 'HEAD');
      assert.ok(git(clone, 'worktree', 'list').includes(dir));
    });
    assert.equal(seen, c1);
    assert.equal(git(clone, 'worktree', 'list'), before);
    await assert.rejects(withWorktree(clone, c1, async () => { throw new Error('boom'); }), /boom/);
    assert.equal(git(clone, 'worktree', 'list'), before);
    assert.equal(git(clone, 'status', '--porcelain'), '');
  });

  it('prunes a worktree whose folder was deleted behind git\'s back (a killed earlier run)', async () => {
    const { clone, c1, c2 } = fixture();
    const stale = join(tmp, `stale${n++}`);
    git(clone, 'worktree', 'add', '--detach', stale, c1);
    rmSync(stale, { recursive: true, force: true });
    assert.ok(git(clone, 'worktree', 'list').includes(stale));
    await withWorktree(clone, c2, async () => {});
    assert.ok(!git(clone, 'worktree', 'list').includes(stale));
  });
});

describe('androidEntry', () => {
  it('fills commit (and the pinned cert) so every release records its source commit', () => {
    const sha = 'ab12'.repeat(10);
    const entry = androidEntry({
      info: { packageName: 'app.netlens', versionCode: 9, versionName: '0.3.0', minSdk: 24 },
      versionName: '0.3.0',
      apkPath: 'apps/netlens/android/9.apk',
      sha256: 'b'.repeat(64),
      sizeBytes: 123,
      commit: sha,
    });
    assert.equal(entry.commit, sha);
    assert.equal(entry.signingCertSha256, SIGNING_CERT_SHA256);
    const m = upsertAndroidRelease(emptyManifest(), { id: 'netlens', name: 'HomeNet', changelog: '' }, entry);
    assert.equal(m.apps[0].android?.commit, sha);
  });
});

const DB_FILE = 'apps/netlens/src/db/device-store-sqlite.ts'; // the registry's HomeNet schema file
function schemaFixture(versions: [number, number, number]) {
  const root = join(tmp, `schema${n++}`);
  const origin = join(root, 'origin.git');
  const clone = join(root, 'clone');
  mkdirSync(root);
  git(root, 'init', '--bare', '-b', 'main', origin);
  git(root, 'clone', origin, clone);
  git(clone, 'checkout', '-B', 'main');
  const shas = versions.map((v, i) => {
    mkdirSync(join(clone, 'apps/netlens/src/db'), { recursive: true });
    writeFileSync(join(clone, DB_FILE), `await db.execAsync('PRAGMA user_version = ${v}');\n`);
    return commitVersion(clone, `0.${i + 1}.0`);
  });
  git(clone, 'push', 'origin', 'main');
  return { clone, shas };
}

describe('rollback over a database', () => {
  it('records what the plan shows: versions, files that change, and every database at both commits', () => {
    const { clone, shas: [c1, c2, c3] } = schemaFixture([1, 1, 2]);
    const plan = planRollback({ repoDir: clone, id: 'netlens', manifest: published(41, c3) });
    assert.equal(plan.toCommit, c2);
    assert.deepEqual(plan.schemas, [{ app: 'netlens', db: 'devices (expo-sqlite)', target: 1, current: 2, verdict: 'newer' }]);
    assert.deepEqual(plan.files.app.sort(), [DB_FILE, 'apps/netlens/app.json'].sort());
    assert.equal(plan.files.other, 0);
    const out = formatPlan(plan, 'store.example');
    assert.ok(out.includes('apps/netlens/android/42.apk is uploaded and manifest.json now points netlens at it'));
    assert.ok(out.includes(`commit ${c2.slice(0, 7)}, rolled back from 0.3.0 (41)`));
    assert.match(out, /files in apps\/netlens that change: 2$/m);
    assert.equal(planRollback({ repoDir: clone, id: 'netlens', manifest: published(41, c3), to: c1 }).schemas[0].target, 1);
  });

  it('is fine when the schema did not change', () => {
    const { clone, shas: [, , c3] } = schemaFixture([2, 2, 2]);
    assert.equal(planRollback({ repoDir: clone, id: 'netlens', manifest: published(41, c3) }).schemas[0].verdict, 'ok');
  });

  it('compares with HEAD and origin/main when the current release has no commit recorded, and can only say unknown', () => {
    const { clone, shas: [c1] } = schemaFixture([1, 1, 2]);
    const plan = planRollback({ repoDir: clone, id: 'netlens', manifest: published(5), to: c1 });
    assert.equal(plan.schemas[0].current, 2);
    assert.equal(plan.schemas[0].verdict, 'unknown');
  });
});

describe('which commits decide what the phones hold', () => {
  const withRolledBack = (versionCode: number, commit: string, from: string): StoreManifest => {
    const m = published(versionCode, commit);
    m.apps[0].android!.rolledBackFrom = { versionCode: versionCode - 1, versionName: '0.3.0', commit: from };
    return m;
  };

  it('refuses when the replaced release\'s commit is unknown and HEAD is older than the published schema', () => {
    const { clone, shas: [c1, c2] } = schemaFixture([1, 1, 2]);
    git(clone, 'checkout', '-q', '--detach', c2); // HEAD behind origin/main, which has the schema 2 commit
    const plan = planRollback({ repoDir: clone, id: 'netlens', manifest: published(5), to: c1 });
    assert.equal(plan.schemas[0].verdict, 'unknown');
    assert.equal(gateRollback(plan, { yes: true, acceptNewerData: false }).exitCode, 1);
  });

  it('with no commit recorded, an ahead schema on origin/main blocks even when HEAD matches the target', () => {
    const { clone, shas: [c1] } = schemaFixture([1, 1, 2]);
    git(clone, 'checkout', '-q', '--detach', c1);
    assert.equal(planRollback({ repoDir: clone, id: 'netlens', manifest: published(5), to: c1 }).schemas[0].verdict, 'unknown');
  });

  it('marks every schema unknown when the recorded commit is missing locally, and never falls back to HEAD', () => {
    const { clone, shas: [c1] } = schemaFixture([2, 2, 2]);
    const plan = planRollback({ repoDir: clone, id: 'netlens', manifest: published(5, 'f'.repeat(40)), to: c1 });
    assert.deepEqual(plan.schemas.map((c) => c.verdict), ['unknown']);
    assert.equal(blockingSchemas(plan).length, 1);
  });

  it('a second rollback also counts the release the first one replaced (c0, c1, c2)', () => {
    const { clone, shas: [c0, c1, c2] } = schemaFixture([1, 1, 2]);
    // c2 (schema 2) was rolled back to c1 (schema 1) with --accept-newer-data; the phones still hold schema 2 data.
    const plan = planRollback({ repoDir: clone, id: 'netlens', manifest: withRolledBack(42, c1, c2), to: c0 });
    assert.equal(plan.schemas[0].current, 2);
    assert.equal(plan.schemas[0].verdict, 'newer');
    assert.equal(planRollback({ repoDir: clone, id: 'netlens', manifest: published(42, c1), to: c0 }).schemas[0].verdict, 'ok');
  });

  it('cannot tell when the replaced release recorded by a rollback is missing locally', () => {
    const { clone, shas: [c0, c1] } = schemaFixture([1, 1, 2]);
    assert.equal(planRollback({ repoDir: clone, id: 'netlens', manifest: withRolledBack(42, c1, 'e'.repeat(40)), to: c0 }).schemas[0].verdict, 'unknown');
  });
});

describe('releaseAndroid refuses a versionCode another release took during the build', () => {
  const root = join(tmp, 'rel-root');
  const apk = join(root, 'fake.apk');
  mkdirSync(join(root, 'apps/netlens/android/app'), { recursive: true });
  writeFileSync(join(root, 'apps/netlens/app.json'), JSON.stringify({ expo: { version: '0.3.0' } }));
  copyFileSync(new URL('./expo-template.build.gradle', import.meta.url), join(root, 'apps/netlens/android/app/build.gradle'));
  writeFileSync(apk, 'apk bytes');
  const build = {
    assembleRelease: () => apk,
    inspectApk: () => ({ packageName: 'app.netlens', versionCode: 25, versionName: '0.3.0', minSdk: 24, signers: [SIGNING_CERT_SHA256] }),
    sha256File: async () => 'c'.repeat(64),
  };
  const run = (live: StoreManifest) => {
    const uploads: string[] = [];
    const result = releaseAndroid({
      root, id: 'netlens', versionCode: 25, changelog: '', commit: 'a'.repeat(40), build,
      fetchManifest: async () => live,
      upload: async (key) => { uploads.push(key); },
    });
    return { result, uploads };
  };

  it('uploads nothing when the live manifest already holds that versionCode', async () => {
    const { result, uploads } = run(published(25));
    await assert.rejects(result, /another release while this one was building/);
    assert.deepEqual(uploads, []);
  });

  it('uploads and publishes when the live manifest is still below it', async () => {
    const { result, uploads } = run(published(24));
    assert.equal((await result).apps[0].android?.versionCode, 25);
    assert.deepEqual(uploads, ['apps/netlens/android/25.apk']);
  });
});

describe('gateRollback', () => {
  const base: RollbackPlan = {
    id: 'netlens', fromCommit: 'a'.repeat(40), fromVersionCode: 41, fromVersionName: '0.3.0', toCommit: 'b'.repeat(40), toVersionName: '0.2.0',
    newVersionCode: 42, changelog: '', files: { app: [], other: 0 }, schemas: [],
  };
  const newer = { app: 'netlens', db: 'devices', target: 1, current: 2, verdict: 'newer' as const };
  const nothingYet = /Nothing was built or published/;

  it('only prints the plan without --yes', () => {
    const g = gateRollback(base, { yes: false, acceptNewerData: false });
    assert.equal(g.proceed, false);
    assert.equal(g.exitCode, 0);
    assert.match(g.lines.join('\n'), /run it again with --yes/);
  });

  it('builds and publishes with --yes when no schema is ahead', () => {
    assert.deepEqual(gateRollback(base, { yes: true, acceptNewerData: false }), { proceed: true, exitCode: 0, lines: [] });
  });

  it('refuses a rollback over a newer schema, with or without --yes, in plain words', () => {
    const plan = { ...base, schemas: [newer] };
    for (const yes of [false, true]) {
      const g = gateRollback(plan, { yes, acceptNewerData: false });
      assert.equal(g.proceed, false);
      assert.equal(g.exitCode, 1);
      const text = g.lines.join('\n');
      assert.match(text, /Not rolled back/);
      assert.match(text, /data is at version 2, the older build understands 1/);
      assert.match(text, /--accept-newer-data/);
      assert.match(text, nothingYet);
    }
  });

  it('refuses a schema it cannot read, like a newer one, but says it could not tell instead of calling the data newer', () => {
    const plan = { ...base, schemas: [{ ...newer, target: null, verdict: 'unknown' as const, why: 'a registered file is missing at one of the commits although the app is there, so it may have moved or been renamed' }] };
    assert.equal(blockingSchemas(plan).length, 1);
    const g = gateRollback(plan, { yes: true, acceptNewerData: false });
    assert.equal(g.exitCode, 1);
    const text = g.lines.join('\n');
    assert.doesNotMatch(text, /newer format/);
    assert.match(text, /could not tell whether netlens's data/);
    assert.ok(text.includes('devices: a registered file is missing'));
    assert.match(text, /Fetch origin.*--accept-newer-data/);
    assert.match(text, nothingYet);
  });

  it('prints both sections when one database is ahead and another cannot be established', () => {
    const text = gateRollback({ ...base, schemas: [newer, { ...newer, db: 'other', verdict: 'unknown' as const, why: 'x' }] }, { yes: true, acceptNewerData: false }).lines.join('\n');
    assert.match(text, /stores data in a newer format/);
    assert.match(text, /could not tell/);
  });

  it('--accept-newer-data prints what is lost and still needs --yes to go ahead', () => {
    const plan = { ...base, schemas: [newer] };
    const stop = gateRollback(plan, { yes: false, acceptNewerData: true });
    assert.equal(stop.proceed, false);
    assert.equal(stop.exitCode, 0);
    const go = gateRollback(plan, { yes: true, acceptNewerData: true });
    assert.equal(go.proceed, true);
    assert.match(go.lines.join('\n'), /will not open newer data until a newer release is installed/);
  });

  it('rolledBackFrom carries the replaced release, and omits an unknown commit', () => {
    assert.deepEqual(rolledBackFrom(base), { versionCode: 41, versionName: '0.3.0', commit: 'a'.repeat(40) });
    assert.deepEqual(rolledBackFrom({ ...base, fromCommit: undefined }), { versionCode: 41, versionName: '0.3.0' });
  });
});

describe('rollbackFlagError', () => {
  it('keeps --yes, --dry-run, --to and --accept-newer-data to a single-app rollback', () => {
    assert.equal(rollbackFlagError({ rollback: true }, 1), null);
    assert.equal(rollbackFlagError({ rollback: true, yes: true, 'accept-newer-data': true, to: 'abc' }, 1), null);
    assert.equal(rollbackFlagError({ rollback: true, 'dry-run': true }, 1), null);
    assert.match(rollbackFlagError({ rollback: true }, 2) ?? '', /exactly one app/);
    assert.match(rollbackFlagError({ rollback: true, all: true }, 1) ?? '', /exactly one app/);
    assert.match(rollbackFlagError({ rollback: true, yes: true, 'dry-run': true }, 1) ?? '', /contradict/);
    for (const v of [{ yes: true }, { 'dry-run': true }, { to: 'abc' }, { 'accept-newer-data': true }]) assert.match(rollbackFlagError(v, 1) ?? '', /only work with --rollback/);
    assert.equal(rollbackFlagError({}, 3), null);
  });
});

describe('rollback result in the manifest', () => {
  it('androidEntry records rolledBackFrom, and the Store manifest keeps it until the next normal release', () => {
    const sha = 'ab12'.repeat(10);
    const from = { versionCode: 41, versionName: '0.3.0', commit: 'cd34'.repeat(10) };
    const entry = androidEntry({
      info: { packageName: 'app.netlens', versionCode: 42, versionName: '0.2.0', minSdk: 24 },
      versionName: '0.2.0', apkPath: 'apps/netlens/android/42.apk', sha256: 'b'.repeat(64), sizeBytes: 123, commit: sha, rolledBackFrom: from,
    });
    const m = upsertAndroidRelease(published(41), { id: 'netlens', name: 'HomeNet', changelog: 'Rollback to 0.2.0' }, entry);
    assert.deepEqual(m.apps[0].android?.rolledBackFrom, from);
    assert.equal(m.apps[0].android?.versionName, '0.2.0');
    assert.equal(m.apps[0].android?.commit, sha);
    assert.equal(upsertAndroidRelease(m, { id: 'netlens', name: 'HomeNet', changelog: '' }, release(43)).apps[0].android?.rolledBackFrom, undefined);
    assert.equal(androidEntry({ info: { packageName: 'app.netlens', versionCode: 9, versionName: '1', minSdk: 24 }, versionName: '1', apkPath: 'x', sha256: 'b'.repeat(64), sizeBytes: 1, commit: sha }).rolledBackFrom, undefined);
  });
});

describe('assertVersionStillFree', () => {
  it('refuses to upload under a versionCode that another release published during the build', () => {
    assert.doesNotThrow(() => assertVersionStillFree(published(24), 'netlens', 25));
    assert.doesNotThrow(() => assertVersionStillFree(emptyManifest(), 'netlens', 2));
    assert.throws(() => assertVersionStillFree(published(25), 'netlens', 25), /another release while this one was building.*Nothing was uploaded/);
    assert.throws(() => assertVersionStillFree(published(26), 'netlens', 25), /Nothing was uploaded/);
  });
});
