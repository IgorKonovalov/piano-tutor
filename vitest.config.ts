import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))

const alias = {
  '@': resolve(root, 'renderer'),
  '@shared': resolve(root, 'shared'),
  '@core': resolve(root, 'core/src'),
}

export default defineConfig({
  test: {
    projects: [
      {
        // core/ and the main-process modules: pure logic, no DOM.
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['core/**/*.test.ts', 'electron/**/*.test.ts', 'shared/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['renderer/**/*.test.ts', 'renderer/**/*.test.tsx'],
        },
      },
    ],
  },
})
