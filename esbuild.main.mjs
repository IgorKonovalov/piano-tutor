import { build, context } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const watch = process.argv.includes('--watch')

// `@julusian/midi` is a compiled N-API addon: esbuild cannot bundle a `.node`
// binary, so it stays external and is resolved from node_modules at runtime.
// electron-builder unpacks it from the asar for the same reason (ADR-0001).
const config = {
  entryPoints: [resolve(root, 'electron/main.ts')],
  outfile: resolve(root, 'dist/main/index.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron', '@julusian/midi'],
  sourcemap: true,
  logLevel: 'info',
}

if (watch) {
  const ctx = await context(config)
  await ctx.watch()
} else {
  await build(config)
}
