import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nextVersionCode, type StoreManifest } from '@apps-hub/store-manifest';
import { APPS } from './apps.ts';
import { WHY, checkSchemas, type SchemaCheck } from './schemas.ts';

export interface RollbackPlan {
  id: string;
  /** Full sha the current published build came from, when the manifest records it. */
  fromCommit?: string;
  fromVersionCode: number;
  fromVersionName: string;
  toCommit: string;
  toVersionName: string;
  /** Strictly above the published versionCode: Android refuses an install over a higher one. */
  newVersionCode: number;
  changelog: string;
  /** Files that differ between the release being replaced and the target (HEAD when no commit is recorded). */
  files: { app: string[]; other: number };
  schemas: SchemaCheck[];
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
 * Previous-release rule: the manifest holds only the latest release, so with no `to` the target is the first
 * parent of the last commit that changed the app's folder at or before the commit recorded on the current entry,
 * that is, the app as it was just before its latest change (the recorded commit itself may be a merge of another
 * app's work, or one HEAD recorded for several apps). `to` (a sha, short sha or tag) overrides it. Either way the
 * target must be on origin/main, older than the current release commit, different from it, contain the app, and
 * differ from the release commit in the app's folder (else there is nothing to roll back).
 * Reads git only; builds and writes nothing.
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
    let changedAt: string;
    try {
      changedAt = git(repoDir, ['log', '-1', '--first-parent', '--format=%H', fromCommit, '--', app.dir]);
    } catch {
      throw new Error(`${id}: the current release commit ${fromCommit.slice(0, 7)} is unknown here. Fetch origin, or pass --to <sha>.`);
    }
    if (!changedAt) throw new Error(`${id}: ${app.dir} has no history up to ${fromCommit.slice(0, 7)}, so there is no earlier version. Pass --to <sha>.`);
    try {
      toCommit = git(repoDir, ['rev-parse', '--verify', '--quiet', `${changedAt}^1^{commit}`]);
    } catch {
      throw new Error(`${id}: ${changedAt.slice(0, 7)}, the commit that first added the app, has no parent, so there is no earlier version. Pass --to <sha>.`);
    }
  }

  if (toCommit === fromCommit) throw new Error(`${id}: the target ${toCommit.slice(0, 7)} is the current release. Pick an older commit with --to.`);
  if (!gitOk(repoDir, ['merge-base', '--is-ancestor', toCommit, mainRef])) {
    throw new Error(`${id}: ${toCommit.slice(0, 7)} is not on ${mainRef}. A rollback may only go to a commit that is on main.`);
  }
  if (fromCommit && gitOk(repoDir, ['cat-file', '-e', `${fromCommit}^{commit}`]) && !gitOk(repoDir, ['merge-base', '--is-ancestor', toCommit, fromCommit])) {
    throw new Error(`${id}: ${toCommit.slice(0, 7)} is newer than the current release ${fromCommit.slice(0, 7)}. A rollback goes back.`);
  }

  if (fromCommit && gitOk(repoDir, ['cat-file', '-e', `${fromCommit}^{commit}`]) && gitOk(repoDir, ['diff', '--quiet', toCommit, fromCommit, '--', app.dir])) {
    throw new Error(`${id}: ${app.dir} is identical at ${toCommit.slice(0, 7)} and at the current release ${fromCommit.slice(0, 7)}, so there is nothing to roll back.`);
  }

  let toVersionName: string;
  try {
    toVersionName = JSON.parse(git(repoDir, ['show', `${toCommit}:${app.dir}/app.json`])).expo.version;
  } catch {
    throw new Error(`${id}: ${app.dir}/app.json does not exist or has no expo.version at ${toCommit.slice(0, 7)}. The app is not in that commit.`);
  }

  const local = (sha: string) => gitOk(repoDir, ['cat-file', '-e', `${sha}^{commit}`]);
  const currentRef = fromCommit !== undefined && local(fromCommit) ? fromCommit : 'HEAD';
  const changed = git(repoDir, ['diff', '--name-only', currentRef, toCommit]).split('\n').filter(Boolean);
  const files = { app: changed.filter((f) => f.startsWith(`${app.dir}/`)), other: changed.filter((f) => !f.startsWith(`${app.dir}/`)).length };

  // Whose data can be on the phones: the published commit and the release a rollback replaced (it may have been
  // accepted over newer data). Missing locally means we cannot tell. With no commit recorded, HEAD and main are a guess.
  const rolledFrom = current.rolledBackFrom?.commit;
  const named = fromCommit ? [fromCommit, ...(rolledFrom ? [rolledFrom] : [])] : undefined;
  const refs = named ? (named.every(local) ? named : null) : gitOk(repoDir, ['rev-parse', '--verify', '--quiet', mainRef]) ? ['HEAD', mainRef] : null;

  const newVersionCode = nextVersionCode(o.manifest, id);
  if (!(newVersionCode > current.versionCode)) throw new Error(`${id}: new versionCode ${newVersionCode} must exceed published ${current.versionCode}.`);
  return {
    id,
    fromCommit,
    fromVersionCode: current.versionCode,
    fromVersionName: current.versionName,
    toCommit,
    toVersionName,
    newVersionCode,
    changelog: `Rollback to ${toVersionName} (${toCommit.slice(0, 7)})`,
    files,
    schemas: checkSchemas(repoDir, id, toCommit, refs, fromCommit !== undefined),
  };
}

export function blockingSchemas(p: RollbackPlan): SchemaCheck[] {
  return p.schemas.filter((c) => c.verdict !== 'ok');
}

export function rolledBackFrom(p: RollbackPlan): { versionCode: number; versionName: string; commit?: string } {
  return { versionCode: p.fromVersionCode, versionName: p.fromVersionName, ...(p.fromCommit ? { commit: p.fromCommit } : {}) };
}

const MAX_LISTED = 15;

function schemaLine(c: SchemaCheck): string {
  return c.verdict === 'unknown'
    ? `  ${c.db}: ${c.why ?? 'could not be established'}`
    : `  ${c.db}: the phone's data is at version ${c.current}, the older build understands ${c.target}`;
}

/** Why a rollback is refused, or what the owner accepted with --accept-newer-data. Empty when every schema is fine. */
export function schemaNotice(p: RollbackPlan, accepted: boolean): string[] {
  const newer = p.schemas.filter((c) => c.verdict === 'newer');
  const unknown = p.schemas.filter((c) => c.verdict === 'unknown');
  if (newer.length + unknown.length === 0) return [];
  if (accepted) {
    return [
      '--accept-newer-data: rolling back over data that may be newer.',
      ...[...newer, ...unknown].map(schemaLine),
      'The app will not open newer data until a newer release is installed. The rollback itself deletes nothing,',
      'but the newer format is unreadable to the old build, and clearing the app\'s storage to recover would lose it.',
    ];
  }
  return [
    ...(newer.length
      ? [`Not rolled back: ${p.id} stores data in a newer format than the older build can open.`, ...newer.map(schemaLine),
         'Installing the older build over it would leave the app unable to start with that data until a newer release is installed.']
      : []),
    ...(unknown.length
      ? [`Not rolled back: the tool could not tell whether ${p.id}'s data on the phone is newer than the older build can open.`, ...unknown.map(schemaLine),
         ...(unknown.some((c) => c.why === WHY.commit) ? ['Fetch origin and run it again, or, if you are sure the data is not newer, pass --accept-newer-data.'] : []),
         ...(unknown.some((c) => c.why !== WHY.commit) ? ["Check the file's history by hand, then pass --accept-newer-data if you are sure the data is not newer."] : [])]
      : []),
    newer.length ? 'Nothing was built or published. To go back anyway, pass --accept-newer-data.' : 'Nothing was built or published.',
  ];
}

/** What the owner has to confirm: the plan, then either why it stops or that --yes is needed. */
export function gateRollback(p: RollbackPlan, o: { yes: boolean; acceptNewerData: boolean }): { proceed: boolean; exitCode: 0 | 1; lines: string[] } {
  const notice = schemaNotice(p, o.acceptNewerData);
  if (blockingSchemas(p).length > 0 && !o.acceptNewerData) return { proceed: false, exitCode: 1, lines: notice };
  if (!o.yes) return { proceed: false, exitCode: 0, lines: [...notice, 'Nothing was built or published. This is the plan only: run it again with --yes to build and publish.'] };
  return { proceed: true, exitCode: 0, lines: notice };
}

export function rollbackFlagError(v: { rollback?: boolean; all?: boolean; to?: string; yes?: boolean; 'dry-run'?: boolean; 'accept-newer-data'?: boolean }, appCount: number): string | null {
  if (v.rollback) {
    if (appCount !== 1 || v.all) return '--rollback takes exactly one app (no --all).';
    if (v.yes && v['dry-run']) return '--yes and --dry-run contradict each other. Drop --dry-run: without --yes a rollback only prints its plan.';
    return null;
  }
  return v['dry-run'] || v.to || v.yes || v['accept-newer-data'] ? '--to, --yes, --dry-run and --accept-newer-data only work with --rollback.' : null;
}

/** The plan output. `target` is the Store host (or "Store"); nothing here touches the network. */
export function formatPlan(p: RollbackPlan, target: string): string {
  const listed = p.files.app.slice(0, MAX_LISTED).map((f) => `  ${f}`);
  if (p.files.app.length > MAX_LISTED) listed.push(`  and ${p.files.app.length - MAX_LISTED} more`);
  return [
    `app: ${p.id}`,
    `from: ${p.fromCommit ?? 'unknown commit'} (versionCode ${p.fromVersionCode})`,
    `to commit: ${p.toCommit} (${p.toVersionName})`,
    `new versionCode: ${p.newVersionCode}`,
    `target: ${target}`,
    `Store changes: apps/${p.id}/android/${p.newVersionCode}.apk is uploaded and manifest.json now points ${p.id} at it`,
    `  (shown as ${p.toVersionName}, commit ${p.toCommit.slice(0, 7)}, rolled back from ${p.fromVersionName} (${p.fromVersionCode}))`,
    `files in ${APPS[p.id].dir} that change: ${p.files.app.length}`,
    ...listed,
    `files outside it that change (shared packages, lockfile): ${p.files.other}`,
  ].join('\n');
}

export function storeTarget(apiUrl: string | undefined): string {
  try {
    return apiUrl ? new URL(apiUrl).host : 'Store';
  } catch {
    return 'Store';
  }
}

/**
 * Run `fn` in a clean detached worktree of `sha`, and always remove it: when `fn` throws, and on SIGINT/SIGTERM.
 * A hard kill skips both, so the next call starts with `git worktree prune` to drop what it left behind.
 */
export async function withWorktree<T>(repoDir: string, sha: string, fn: (dir: string) => Promise<T>): Promise<T> {
  git(repoDir, ['worktree', 'prune']);
  const tmp = mkdtempSync(join(tmpdir(), 'rollback-'));
  const dir = join(tmp, 'tree');
  git(repoDir, ['worktree', 'add', '--detach', dir, sha]);
  const cleanup = () => {
    try {
      git(repoDir, ['worktree', 'remove', '--force', dir]);
    } catch {
      // already gone; prune handles the rest
    }
    rmSync(tmp, { recursive: true, force: true });
  };
  const onSignal = (sig: NodeJS.Signals) => {
    cleanup();
    process.exit(sig === 'SIGINT' ? 130 : 143);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    return await fn(dir);
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    cleanup();
  }
}

/** pnpm install in the temporary tree: it has no node_modules of its own. */
export function installDeps(dir: string): void {
  execFileSync('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], { cwd: dir, stdio: 'inherit' });
}
