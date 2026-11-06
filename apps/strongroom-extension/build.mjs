// Bundles the three scripts Chrome loads and copies the static files into dist/, ready for "Load unpacked".
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYNC_URL } from './src/sync-url.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = (...p) => join(here, ...p);
const out = process.env.STRONGROOM_OUT ?? root('dist');
// STRONGROOM_SYNC_URL points an e2e build at a local Worker; a release build leaves it unset and takes SYNC_URL from the source.
const syncUrl = process.env.STRONGROOM_SYNC_URL ?? SYNC_URL;
const origin = syncUrl && new URL(syncUrl).origin;
if (origin && !origin.startsWith('https://') && !/^http:\/\/(127\.0\.0\.1|localhost)(:|$)/.test(origin)) throw new Error('The sync server address must be https (plain http only on this computer).');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: { background: root('src/background.ts'), popup: root('src/popup.ts'), content: root('src/content.ts') },
  bundle: true,
  format: 'iife',
  target: 'chrome127',
  outdir: out,
  define: { __SYNC_URL__: JSON.stringify(syncUrl) },
  logLevel: 'warning',
});

const manifest = JSON.parse(readFileSync(root('src/manifest.json'), 'utf8'));
if (origin) manifest.host_permissions = [`${origin}/*`];
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
for (const f of ['popup.html', 'popup.css']) cpSync(root('src', f), join(out, f));
const ui = root('../../packages/ui');
for (const f of ['tokens.css', 'base.css']) cpSync(join(ui, 'web', f), join(out, 'web', f));
mkdirSync(join(out, 'fonts'), { recursive: true });
for (const f of readdirSync(join(ui, 'fonts')).filter((n) => n.endsWith('.ttf'))) cpSync(join(ui, 'fonts', f), join(out, 'fonts', f));
const android = root('../strongroom');
cpSync(join(android, 'assets/icon.png'), join(out, 'icon.png'));
cpSync(join(android, 'modules/strongroom-vault/android/src/main/resources/public_suffix_list.dat'), join(out, 'public_suffix_list.dat'));
console.log('Built', out);
