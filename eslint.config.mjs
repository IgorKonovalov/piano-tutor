import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

// The process boundaries of ADR-0001 are checked here as well as by the four
// tsconfigs: a tsconfig catches a missing type, this catches an import that
// happens to typecheck. `core/` stays pure, the renderer never reaches the OS
// or the network, main never imports React.
const NODE_BUILTINS = ['node:*', 'fs', 'path', 'os', 'child_process', 'http', 'https', 'net']

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'release/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      // Harness files, not project source: the skills' templates are excerpts
      // and the hooks are plain CommonJS run by the tool, not by the app.
      '.claude/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },

  // core/ — pure TypeScript. No process, no DOM, no clock, no unseeded randomness.
  {
    files: ['core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: [...NODE_BUILTINS, 'electron', 'react', 'react-dom', 'vexflow'] },
            { group: ['@/*'], message: 'core/ must not import from the renderer.' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'core/ is pure: no DOM.' },
        { name: 'document', message: 'core/ is pure: no DOM.' },
        { name: 'navigator', message: 'core/ is pure: no DOM.' },
        { name: 'process', message: 'core/ is pure: no Node.' },
        { name: 'performance', message: 'core/ is pure: time is an input, not a reading.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'core/ is deterministic: take a seed.' },
        { object: 'Date', property: 'now', message: 'core/ is pure: time is an input.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'core/ is pure: time enters as an event timestamp.',
        },
      ],
    },
  },

  // renderer/ — React, no OS, no network. The CSP has no connect-src; these
  // rules make a reach for one fail the gate rather than the browser console.
  {
    files: ['renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...NODE_BUILTINS, 'electron', '@julusian/*'],
              message: 'The renderer never touches the OS. Add a narrow window.api capability.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'NFR 3: the renderer makes no network request.' },
        { name: 'XMLHttpRequest', message: 'NFR 3: the renderer makes no network request.' },
        { name: 'WebSocket', message: 'NFR 3: the renderer makes no network request.' },
        { name: 'require', message: 'The renderer is sandboxed; there is no require.' },
      ],
    },
  },

  // main and preload — Node and Electron, never UI.
  {
    files: ['electron/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*', '@/*'],
              message: 'Main holds no UI state and never imports React.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  {
    files: ['**/*.mjs', '*.config.ts'],
    languageOptions: { globals: globals.node, sourceType: 'module' },
  },

  prettier
)
