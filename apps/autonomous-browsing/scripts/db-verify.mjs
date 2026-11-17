// Bundles the TS verify script and runs it under Electron-as-Node: postinstall
// rebuilds better-sqlite3 against Electron's ABI, so plain `node` cannot load
// it. spawnSync keeps the env handling portable (no POSIX inline assignment),
// and .cache/ keeps the bundle out of electron-builder's out/** glob.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'

const require = createRequire(import.meta.url)
const electronBinary = require('electron')

buildSync({
  entryPoints: ['tests/db.verify.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['better-sqlite3'],
  outfile: '.cache/db.verify.mjs',
  logLevel: 'warning'
})

const result = spawnSync(electronBinary, ['.cache/db.verify.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
process.exit(result.status ?? 1)
