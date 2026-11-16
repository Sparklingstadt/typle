import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

// Packages that tie code to the UI, the framework or a storage backend.
const frameworks = ['react', 'react-dom', 'next', 'next/*', 'next-intl', 'next-intl/*', '@sentry/*', 'pg']

export default defineConfig([
  ...nextVitals,
  // core is plain TypeScript: the rules of word lists, typing, records and the workspace, used by every screen and store.
  // The official packs (src/core/packs) are part of it, so each depth of core gets the same rule with its own way out.
  ...[['src/core/*', 1], ['src/core/packs/*', 2], ['src/core/packs/commands/*', 3]].map(([files, depth]) => ({
    files: [files],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { group: frameworks, message: 'src/core must not depend on the UI, the framework or a storage backend.' },
        // The error keys' type comes from the Japanese messages; anything else outside core is off limits.
        { regex: `^(@/(?!messages/)|${'\\.\\./'.repeat(depth)}(?!messages/))`, message: 'src/core may only import from src/core.' },
      ] }],
    },
  })),
  // Screens reach the workspace through useWordLists (src/lib), which chooses the store (src/lib/storage); the server side
  // is the Go backend and the Route Handlers (src/app/api), whose code (src/server) runs on the server only.
  {
    files: ['src/app/**', 'src/components/**'],
    ignores: ['src/app/api/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { regex: '^(@/|(\\.\\./)+)lib/storage(/|$)', message: 'Screens get the workspace and where it is saved from useWordLists, not from a store.' },
        { regex: '^(@/|(\\.\\./)+)server(/|$)', message: 'src/server is for the Route Handlers (src/app/api) only.' },
        // components.json names @/lib/utils, so what shadcn adds and what is written by hand import cn alike.
        { group: ['cn'], message: 'Import cn from @/lib/utils.' },
      ] }],
    },
  },
  globalIgnores(['.next/**', '.next-production/**', 'test-results/**', 'playwright-report/**', 'next-env.d.ts', 'api-docs/**', '.claude/**']),
])
