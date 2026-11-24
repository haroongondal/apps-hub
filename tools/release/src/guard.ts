import { execFileSync } from 'node:child_process';

export type Releasable = { ok: true; head: string; warning?: string } | { ok: false; reason: string };

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function readHead(repoDir: string): string {
  return git(repoDir, ['rev-parse', 'HEAD']);
}

export function shortHead(repoDir: string): string {
  return git(repoDir, ['rev-parse', '--short', 'HEAD']);
}

/**
 * A release must come from a clean tree whose HEAD is already on origin/main, so a branch build can never
 * replace a main build in the Store. fromBranch overrides both checks and returns a loud warning instead.
 */
export function checkReleasable(repoDir: string, opts: { fromBranch: boolean; fetch?: boolean }): Releasable {
  const head = readHead(repoDir);
  const problems: string[] = [];

  if (opts.fetch !== false) {
    try {
      git(repoDir, ['fetch', 'origin', 'main']);
    } catch (e) {
      problems.push(`Could not fetch origin/main (${firstLine(e)}). Check the network and the origin remote, then run it again.`);
    }
  }
  if (problems.length === 0) {
    try {
      git(repoDir, ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main']);
      try {
        git(repoDir, ['merge-base', '--is-ancestor', 'HEAD', 'origin/main']);
      } catch {
        problems.push('HEAD is not on origin/main. Merge your branch into main and push it first.');
      }
    } catch {
      problems.push('There is no origin/main in this repo. Add the origin remote and push main first.');
    }
  }
  if (git(repoDir, ['status', '--porcelain', '--untracked-files=all']) !== '') {
    problems.push('The working tree has uncommitted or untracked files. Commit, stash or delete them first.');
  }

  if (problems.length === 0) return { ok: true, head };
  if (!opts.fromBranch) {
    return { ok: false, reason: `${problems.join('\n')}\nFor a test build only, pass --from-branch.` };
  }
  const bar = '!'.repeat(72);
  const warning = [
    bar,
    `!! BRANCH BUILD ${head.slice(0, 7)}: --from-branch skips the release checks.`,
    ...problems.map((p) => `!! ${p}`),
    '!! This build can replace a main build in the Store and may lack features.',
    bar,
  ].join('\n');
  return { ok: true, head, warning };
}

function firstLine(e: unknown): string {
  const text = e instanceof Error ? ((e as { stderr?: string }).stderr || e.message) : String(e);
  return text.trim().split('\n')[0];
}
