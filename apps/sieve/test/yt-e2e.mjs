// Local YouTube fixture e2e: `pnpm --filter sieve test:yt` (build first). `--only a,b` runs just those modules in test/yt/ (fixture always runs).
import { tmpdir } from 'node:os';
import { check, launch, results, startServers } from './harness.mjs';
import { ytModules } from './yt/helpers.mjs';

const arg = process.argv.indexOf('--only');
const only = arg > 0 ? (process.argv[arg + 1] ?? '').split(',').filter(Boolean) : null;
const modules = await ytModules(only);
const servers = await startServers();
const { ctx, sw, id } = await launch({ extraHosts: ['www.youtube-nocookie.com', 'm.youtube.com'], extraArgs: ['--autoplay-policy=no-user-gesture-required'] });
const t = { ctx, sw, id, servers, check, errors: [], shots: process.env.SHOTS ?? tmpdir(), base: `https://www.youtube.com:${servers.httpsPort}` };
try {
  for (const [name, mod] of modules) {
    if (mod.importError) {
      check(`${name}: the module loads`, false, mod.importError);
      continue;
    }
    if (typeof mod.local !== 'function') continue;
    try {
      await mod.local(t);
    } catch (e) {
      check(`${name}: finished without throwing`, false, String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
    }
  }
  check('no page errors on any fixture page', t.errors.length === 0, t.errors.slice(0, 3).join(' | '));
} finally {
  await ctx.close().catch(() => {});
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\npass ${results.length - failed} / fail ${failed}`);
process.exit(failed ? 1 : 0);
