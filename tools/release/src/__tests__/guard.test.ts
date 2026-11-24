import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { checkReleasable, readHead } from '../guard.ts';

const tmp = mkdtempSync(join(tmpdir(), 'release-guard-'));
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
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' }).trim();
const commit = (dir: string, file: string, text = file) => {
  writeFileSync(join(dir, file), text);
  git(dir, 'add', file);
  git(dir, 'commit', '-m', `add ${file}`);
};

let n = 0;
/** A bare origin plus a clone of it with one pushed commit on main. */
function fixture() {
  const root = join(tmp, String(n++));
  const origin = join(root, 'origin.git');
  const clone = join(root, 'clone');
  mkdirSync(root);
  git(root, 'init', '--bare', '-b', 'main', origin);
  git(root, 'clone', origin, clone);
  git(clone, 'checkout', '-B', 'main');
  commit(clone, 'a.txt');
  git(clone, 'push', 'origin', 'main');
  return { root, origin, clone };
}
// Both git and the guard read env from process.env; point the guard's git calls at the same isolated config.
Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' });

describe('checkReleasable', () => {
  it('passes on a clean tree at the tip of origin/main', () => {
    const { clone } = fixture();
    const r = checkReleasable(clone, { fromBranch: false });
    assert.deepEqual(r, { ok: true, head: readHead(clone) });
  });

  it('passes when HEAD is behind a newer origin/main', () => {
    const { root, origin, clone } = fixture();
    const other = join(root, 'other');
    git(root, 'clone', origin, other);
    commit(other, 'b.txt');
    git(other, 'push', 'origin', 'main');
    const r = checkReleasable(clone, { fromBranch: false });
    assert.equal(r.ok, true);
  });

  it('refuses a modified tracked file', () => {
    const { clone } = fixture();
    writeFileSync(join(clone, 'a.txt'), 'changed');
    const r = checkReleasable(clone, { fromBranch: false });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /uncommitted or untracked/);
  });

  it('refuses an untracked file but allows a git-ignored one', () => {
    const { clone } = fixture();
    commit(clone, '.gitignore', 'ignored.txt\n');
    git(clone, 'push', 'origin', 'main');
    writeFileSync(join(clone, 'ignored.txt'), 'x');
    assert.equal(checkReleasable(clone, { fromBranch: false }).ok, true);
    writeFileSync(join(clone, 'new.txt'), 'x');
    assert.equal(checkReleasable(clone, { fromBranch: false }).ok, false);
  });

  it('refuses an untracked file even when status.showUntrackedFiles is no', () => {
    const { clone } = fixture();
    git(clone, 'config', 'status.showUntrackedFiles', 'no');
    writeFileSync(join(clone, 'new.txt'), 'x');
    assert.equal(checkReleasable(clone, { fromBranch: false }).ok, false);
  });

  it('refuses a feature branch with an unmerged commit', () => {
    const { clone } = fixture();
    git(clone, 'checkout', '-b', 'feature');
    commit(clone, 'f.txt');
    const r = checkReleasable(clone, { fromBranch: false });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /HEAD is not on origin\/main/);
    assert.match((r as { reason: string }).reason, /--from-branch/);
  });

  it('refuses when there is no origin/main', () => {
    const root = join(tmp, `lone${n++}`);
    mkdirSync(root);
    git(root, 'init', '-b', 'main');
    commit(root, 'a.txt');
    const r = checkReleasable(root, { fromBranch: false });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /Could not fetch origin\/main/);
  });

  it('refuses when origin/main is gone and the fetch is skipped', () => {
    const root = join(tmp, `lone${n++}`);
    mkdirSync(root);
    git(root, 'init', '-b', 'main');
    commit(root, 'a.txt');
    const r = checkReleasable(root, { fromBranch: false, fetch: false });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /no origin\/main/);
  });

  it('--from-branch passes a dirty tree with a loud warning and the short sha', () => {
    const { clone } = fixture();
    writeFileSync(join(clone, 'a.txt'), 'changed');
    const r = checkReleasable(clone, { fromBranch: true });
    assert.equal(r.ok, true);
    const warning = (r as { warning?: string }).warning ?? '';
    assert.match(warning, /!!!!!/);
    assert.match(warning, /BRANCH BUILD/);
    assert.ok(warning.includes(readHead(clone).slice(0, 7)));
  });

  it('--from-branch passes an unmerged branch with a warning', () => {
    const { clone } = fixture();
    git(clone, 'checkout', '-b', 'feature');
    commit(clone, 'f.txt');
    const r = checkReleasable(clone, { fromBranch: true });
    assert.equal(r.ok, true);
    assert.match((r as { warning?: string }).warning ?? '', /HEAD is not on origin\/main/);
  });

  it('--from-branch on a releasable repo gives no warning', () => {
    const { clone } = fixture();
    assert.equal((checkReleasable(clone, { fromBranch: true }) as { warning?: string }).warning, undefined);
  });
});
