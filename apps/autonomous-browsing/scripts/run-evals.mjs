// Plain Node is enough here: evals never touch better-sqlite3 or Electron APIs.
import { spawnSync } from 'node:child_process'
import { buildSync } from 'esbuild'

buildSync({
  entryPoints: ['evals/run.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  outfile: '.cache/evals.cjs',
  logLevel: 'warning'
})

const result = spawnSync(process.execPath, ['.cache/evals.cjs', ...process.argv.slice(2)], {
  stdio: 'inherit'
})
process.exit(result.status ?? 1)
