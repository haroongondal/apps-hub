import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { SIGNING_CERT_SHA256, emptyManifest, upsertAndroidRelease, type AndroidRelease, type StoreManifest } from '@apps-hub/store-manifest';
import { androidEntry } from '../release-android.ts';
import { formatPlan, planRollback, storeTarget, withWorktree } from '../rollback.ts';

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
  it('prints app, from, to, new versionCode and target, and leaves no worktree behind', () => {
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
