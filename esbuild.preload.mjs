import { build, context } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const watch = process.argv.includes('--watch')

const config = {
  entryPoints: [resolve(root, 'electron/preload/index.ts')],
  outfile: resolve(root, 'dist/preload/index.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
}

if (watch) {
  const ctx = await context(config)
  await ctx.watch()
} else {
  await build(config)
}
