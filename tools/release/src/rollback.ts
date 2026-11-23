import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nextVersionCode, type StoreManifest } from '@apps-hub/store-manifest';
import { APPS } from './apps.ts';

export interface RollbackPlan {
  id: string;
  /** Full sha the current published build came from, when the manifest records it. */
  fromCommit?: string;
  fromVersionCode: number;
  toCommit: string;
  toVersionName: string;
  /** Strictly above the published versionCode: Android refuses an install over a higher one. */
  newVersionCode: number;
  changelog: string;
}

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gitOk = (cwd: string, args: string[]): boolean => {
  try {
    git(cwd, args);
    return true;
  } catch {
    return false;
  }
};

/**
 * Decide what a rollback of `id` would build, or throw an Error saying why it cannot.
 *
 * Previous-release rule: the manifest holds only the latest release, so with no `to` the target is the
 * first parent of the commit recorded on the current entry (main as it was just before the released change).
 * `to` (a sha, short sha or tag) overrides it. Either way the target must be on origin/main, older than the
 * current release commit and different from it, and contain the app. Reads git only; builds and writes nothing.
 */
export function planRollback(o: { repoDir: string; id: string; manifest: StoreManifest; to?: string; mainRef?: string }): RollbackPlan {
  const { repoDir, id } = o;
  const mainRef = o.mainRef ?? 'origin/main';
  const app = APPS[id];
  if (!app) throw new Error(`${id}: not a releasable app.`);
  const current = o.manifest.apps.find((a) => a.id === id)?.android;
  if (!current) throw new Error(`${id}: there is no published release to roll back from.`);

  const fromCommit = current.commit;
  let toCommit: string;
  if (o.to) {
    try {
      toCommit = git(repoDir, ['rev-parse', '--verify', '--quiet', `${o.to}^{commit}`]);
    } catch {
      throw new Error(`--to ${o.to}: no such commit here. Use a sha or tag, and fetch first.`);
    }
  } else {
    if (!fromCommit) {
      throw new Error(`${id}: the published release (versionCode ${current.versionCode}) has no commit recorded, so the previous release cannot be determined. Pass --to <sha>.`);
    }
    try {
      toCommit = git(repoDir, ['rev-parse', '--verify', '--quiet', `${fromCommit}^1^{commit}`]);
    } catch {
      throw new Error(`${id}: the current release commit ${fromCommit.slice(0, 7)} is unknown here or has no parent. Fetch origin, or pass --to <sha>.`);
    }
  }

  if (toCommit === fromCommit) throw new Error(`${id}: the target ${toCommit.slice(0, 7)} is the current release. Pick an older commit with --to.`);
  if (!gitOk(repoDir, ['merge-base', '--is-ancestor', toCommit, mainRef])) {
    throw new Error(`${id}: ${toCommit.slice(0, 7)} is not on ${mainRef}. A rollback may only go to a commit that is on main.`);
  }
  if (fromCommit && gitOk(repoDir, ['cat-file', '-e', `${fromCommit}^{commit}`]) && !gitOk(repoDir, ['merge-base', '--is-ancestor', toCommit, fromCommit])) {
    throw new Error(`${id}: ${toCommit.slice(0, 7)} is newer than the current release ${fromCommit.slice(0, 7)}. A rollback goes back.`);
  }

  let toVersionName: string;
  try {
    toVersionName = JSON.parse(git(repoDir, ['show', `${toCommit}:${app.dir}/app.json`])).expo.version;
  } catch {
    throw new Error(`${id}: ${app.dir}/app.json does not exist or has no expo.version at ${toCommit.slice(0, 7)}. The app is not in that commit.`);
  }

  const newVersionCode = nextVersionCode(o.manifest, id);
  if (!(newVersionCode > current.versionCode)) throw new Error(`${id}: new versionCode ${newVersionCode} must exceed published ${current.versionCode}.`);
  return {
    id,
    fromCommit,
    fromVersionCode: current.versionCode,
    toCommit,
    toVersionName,
    newVersionCode,
    changelog: `Rollback to ${toVersionName} (${toCommit.slice(0, 7)})`,
  };
}

/** The dry-run output. `target` is the Store host (or "Store"); nothing here touches the network. */
export function formatPlan(p: RollbackPlan, target: string): string {
  return [
    `app: ${p.id}`,
    `from: ${p.fromCommit ?? 'unknown commit'} (versionCode ${p.fromVersionCode})`,
    `to commit: ${p.toCommit} (${p.toVersionName})`,
    `new versionCode: ${p.newVersionCode}`,
    `target: ${target}`,
  ].join('\n');
}

export function storeTarget(apiUrl: string | undefined): string {
  try {
    return apiUrl ? new URL(apiUrl).host : 'Store';
  } catch {
    return 'Store';
  }
}

/** Run `fn` in a clean detached worktree of `sha`, and always remove it (even when `fn` throws). */
export async function withWorktree<T>(repoDir: string, sha: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), 'rollback-'));
  const dir = join(tmp, 'tree');
  git(repoDir, ['worktree', 'add', '--detach', dir, sha]);
  try {
    return await fn(dir);
  } finally {
    try {
      git(repoDir, ['worktree', 'remove', '--force', dir]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
}

/** pnpm install in the temporary tree: it has no node_modules of its own. */
export function installDeps(dir: string): void {
  execFileSync('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], { cwd: dir, stdio: 'inherit' });
}
