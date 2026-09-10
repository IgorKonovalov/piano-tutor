import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: resolve(root, 'renderer'),
  // Relative base: packaged the renderer is loaded over file://, where an
  // absolute '/assets/...' would resolve to the filesystem root.
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(root, 'renderer'),
      '@shared': resolve(root, 'shared'),
      '@core': resolve(root, 'core/src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: resolve(root, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: true,
  },
})
