// CI: prints the release ids of Store apps affected by commits since <base>, using pnpm's own dependency
// graph (an app, its native modules and every workspace package it depends on). Docs-only changes don't count.
import { execFileSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { releaseIdsForDirs } from './apps.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });

let base = process.argv[2] ?? '';
try {
  execFileSync('git', ['cat-file', '-e', `${base}^{commit}`], { cwd: ROOT, stdio: 'ignore' });
} catch {
  base = 'HEAD~1'; // new branch, force push or no base given
}
const affected: { path: string }[] = JSON.parse(
  run('pnpm', ['--filter', `...[${base}]`, '--changed-files-ignore-pattern=**/*.md', 'ls', '--depth', '-1', '--json']) || '[]',
);
console.log(releaseIdsForDirs(affected.map((p) => relative(ROOT, p.path))).join(' '));
