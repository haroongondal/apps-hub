import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPS = {
  sieve: { pkg: 'sieve', dir: 'apps/sieve', idVar: 'SIEVE_EXTENSION_ID' },
  strongroom: { pkg: 'strongroom-extension', dir: 'apps/strongroom-extension', idVar: 'STRONGROOM_EXTENSION_ID' },
};
const CLI = 'chrome-webstore-upload-cli@4.0.2';

const args = process.argv.slice(2);
const app = APPS[args.find((a) => !a.startsWith('--'))];
if (!app) {
  console.error('Usage: node tools/webstore/publish.mjs <sieve|strongroom> [--publish] [--no-build] [--root=<checkout>]');
  process.exit(2);
}
try { process.loadEnvFile(join(repo, 'tools/webstore/.env')); } catch { /* the file is optional */ }
const root = resolve(args.find((a) => a.startsWith('--root='))?.slice(7) ?? repo);

const missing = ['CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN', 'PUBLISHER_ID', app.idVar].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing ${missing.join(', ')}. Set them in the environment or in tools/webstore/.env.`);
  process.exit(2);
}
const dist = join(root, app.dir, 'dist');
if (!args.includes('--no-build')) execFileSync('pnpm', ['--filter', app.pkg, 'build'], { cwd: root, stdio: 'inherit' });
if (!existsSync(join(dist, 'manifest.json'))) {
  console.error(`No build at ${dist}. Run without --no-build, or check that ${app.dir} exists on this branch.`);
  process.exit(1);
}

const run = (command, extra = []) => execFileSync('npx', ['--yes', CLI, command, ...extra, '--extension-id', process.env[app.idVar]], { stdio: 'inherit' });
run('upload', ['--source', dist]);
if (args.includes('--publish')) run('publish');
else console.log('Uploaded as a draft. Re-run with --publish (or press Submit in the dashboard) to send it for review.');
