// The downloads e2e runner: every test/dl/*.mjs whose name does not start with `_`, in name order, each exporting `run(t)`.
//   node test/dl/e2e.mjs [--only a,b] [--big]     (pnpm --filter sieve test:dl; test/e2e.mjs also calls run())
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { check, launch, results } from '../harness.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));

export async function run(_ctxIn = {}) {
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
  const modules = readdirSync(here)
    .filter((f) => f.endsWith('.mjs') && !f.startsWith('_') && f !== 'e2e.mjs')
    .map((f) => f.slice(0, -4))
    .filter((name) => !only || only.includes(name))
    .sort();
  const { ctx, sw, id } = await launch();
  const errors = [];
  let fx = null;
  if (existsSync(`${here}_fixture.mjs`)) {
    try {
      fx = await (await import('./_fixture.mjs')).startFixture();
    } catch (e) {
      console.warn(`The fixture server did not start (${e.message}); modules that need it will fail.`);
    }
  }
  const t = { ctx, sw, id, fx, check, errors, shots: process.env.SHOTS ?? tmpdir(), big: process.argv.includes('--big'), only };
  try {
    for (const name of modules) {
      try {
        await (await import(`./${name}.mjs`)).run(t);
      } catch (e) {
        check(`dl/${name} finished without an exception`, false, String(e?.stack ?? e).split('\n').slice(0, 4).join(' | '));
      }
    }
  } finally {
    await fx?.close?.();
    await ctx.close();
  }
  if (errors.length) console.log('dl page errors:', errors);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run();
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
