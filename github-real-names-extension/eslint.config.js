import js from '@eslint/js'
import ts from 'typescript-eslint'

export default [
  {
    ignores: ['.output', '.wxt', 'node_modules', '.dev-profile/**'],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    // The debugging helpers under scripts/ are plain Node ES modules, not extension code:
    // they talk to Chrome over the DevTools protocol. Without declaring the Node globals
    // they use, `no-undef` fails the lint — and `npm run check` gates the release workflow,
    // so a red lint here blocks publishing a release.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        setTimeout: 'readonly',
        URL: 'readonly',
      },
    },
  },
]
