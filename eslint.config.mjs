import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

export default defineConfig([
  ...nextVitals,
  // Screens reach the workspace through useWordLists (src/hooks), which chooses the store (src/lib/storage); the server side
  // is the Route Handlers (src/app/api), whose code (src/server) runs on the server only.
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
  globalIgnores(['.next/**', '.next-production/**', 'test-results/**', 'playwright-report/**', 'next-env.d.ts', 'api-docs/**', 'infra/**', 'rails/**', '.claude/**']),
])
