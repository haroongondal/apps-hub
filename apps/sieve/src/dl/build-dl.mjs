import { build } from 'esbuild';
import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// The offscreen document and its Worker are classic scripts; the list page is a module (it exists from Task 3.15 on).
// `root` is build.mjs's path helper (relative to apps/sieve); the shared UI files are copied by build.mjs itself.
export async function buildDownloads({ out, root }) {
  await build({
    entryPoints: { offscreen: root('src/offscreen/offscreen.ts'), 'engine-worker': root('src/offscreen/engine-worker.ts') },
    bundle: true,
    format: 'iife',
    target: 'chrome128',
    outdir: out,
    logLevel: 'warning',
  });
  const list = root('src/dl/list.ts');
  if (existsSync(list)) await build({ entryPoints: { downloads: list }, bundle: true, format: 'esm', target: 'chrome128', outdir: out, logLevel: 'warning' });
  const copies = [['src/offscreen/offscreen.html', 'offscreen.html'], ['src/dl/list.html', 'downloads.html'], ['src/dl/list.css', 'downloads.css']];
  for (const [from, to] of copies) if (existsSync(root(from))) cpSync(root(from), join(out, to));
}
