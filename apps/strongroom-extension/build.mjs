// Bundles the three scripts Chrome loads and copies the static files into dist/, ready for "Load unpacked".
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = (...p) => join(here, ...p);
const out = root('dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: { background: root('src/background.ts'), popup: root('src/popup.ts'), content: root('src/content.ts') },
  bundle: true,
  format: 'iife',
  target: 'chrome127',
  outdir: out,
  logLevel: 'warning',
});

for (const f of ['manifest.json', 'popup.html', 'popup.css']) cpSync(root('src', f), join(out, f));
const ui = root('../../packages/ui');
for (const f of ['tokens.css', 'base.css']) cpSync(join(ui, 'web', f), join(out, 'web', f));
mkdirSync(join(out, 'fonts'), { recursive: true });
for (const f of readdirSync(join(ui, 'fonts')).filter((n) => n.endsWith('.ttf'))) cpSync(join(ui, 'fonts', f), join(out, 'fonts', f));
const android = root('../strongroom');
cpSync(join(android, 'assets/icon.png'), join(out, 'icon.png'));
cpSync(join(android, 'modules/strongroom-vault/android/src/main/resources/public_suffix_list.dat'), join(out, 'public_suffix_list.dat'));
console.log('Built', out);
