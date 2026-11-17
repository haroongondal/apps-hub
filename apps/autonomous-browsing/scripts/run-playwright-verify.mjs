// The raw plugin stands in for Vite's ?raw suffix, which esbuild does not know.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'

const raw = {
  name: 'raw',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path.slice(0, -'?raw'.length)),
      namespace: 'raw'
    }))
    pluginBuild.onLoad({ filter: /.*/, namespace: 'raw' }, (args) => ({
      contents: readFileSync(args.path, 'utf8'),
      loader: 'text'
    }))
  }
}

await build({
  entryPoints: ['tests/playwright.verify.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['playwright-core', 'electron', 'cheerio'],
  plugins: [raw],
  outfile: '.cache/playwright.verify.mjs',
  logLevel: 'warning'
})

const result = spawnSync(process.execPath, ['.cache/playwright.verify.mjs'], { stdio: 'inherit' })
process.exit(result.status ?? 1)
