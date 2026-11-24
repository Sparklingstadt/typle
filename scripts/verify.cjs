// Runs, in order, every check a commit must pass before it is released (docs/release-workflow.md), and stops at the
// first failure: the migrations on the local database, the migration tests, the type check, the unit tests, lint,
// knip, the production build, the AWS infrastructure's (infra/) type check, tests and synth, the end-to-end tests,
// and the API documentation's build and link check. They run on the developer's machine, before a PR is opened and
// again on the merged main commit before it is released, and in GitHub Actions on every pull request and on main
// (.github/workflows/ci.yml, since v2.60.3; there was no CI from v2.38.1 to v2.60.2). On main the CI releases and
// deploys the commit when they pass (since v2.60.6).
//
//   npm run verify            every check
//   npm run verify -- --fast  without the end-to-end tests and the API documentation, for a quick look while working
//
// Needs the local PostgreSQL (docker compose --env-file .env.local up -d --wait) and Node.js 24. DATABASE_URL
// from .env.local (in the CI, from the environment) is migrated and used by the DB tests and the end-to-end tests, which add rows under random owners
// and delete them afterwards. TYPLE_TEST_DATABASE_URL, when set, is used for the DB tests instead.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
require('@next/env').loadEnvConfig(root)

const fast = process.argv.includes('--fast')
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('Set DATABASE_URL in .env.local (node scripts/setup-local.cjs) and start the database: ' +
    'docker compose --env-file .env.local up -d --wait')
  process.exit(1)
}
const testDatabaseUrl = process.env.TYPLE_TEST_DATABASE_URL || databaseUrl
const docsDir = path.join(root, 'api-docs')
const infraDir = path.join(root, 'infra')

/** @type {{ name: string, command: string, args: string[], env?: Record<string, string>, cwd?: string }[]} */
const steps = [
  { name: 'db:migrate', command: 'npm', args: ['run', 'db:migrate'] },
  { name: 'migration tests', command: 'node', args: ['--test', 'tests/migrate.test.cjs'], env: { TYPLE_TEST_DATABASE_URL: testDatabaseUrl } },
  { name: 'typecheck', command: 'npm', args: ['run', 'typecheck'] },
  { name: 'unit tests', command: 'npm', args: ['test'], env: { TYPLE_TEST_DATABASE_URL: testDatabaseUrl } },
  { name: 'lint', command: 'npm', args: ['run', 'lint'] },
  { name: 'knip', command: 'npm', args: ['run', 'knip'] },
  { name: 'build', command: 'npm', args: ['run', 'build'] },
]
// infra/ (the AWS CDK app) is its own npm project, as api-docs/ is; its checks are quick, so --fast keeps them.
if (!fs.existsSync(path.join(infraDir, 'node_modules'))) {
  steps.push({ name: 'infra: npm ci', command: 'npm', args: ['ci'], cwd: infraDir })
}
steps.push({ name: 'infra: typecheck', command: 'npm', args: ['run', 'typecheck'], cwd: infraDir })
steps.push({ name: 'infra: tests', command: 'npm', args: ['test'], cwd: infraDir })
steps.push({ name: 'infra: synth', command: 'npm', args: ['run', 'synth'], cwd: infraDir })
if (!fast) {
  steps.push({ name: 'end-to-end tests', command: 'npm', args: ['run', 'test:e2e'], env: { DATABASE_URL: databaseUrl } })
  if (!fs.existsSync(path.join(docsDir, 'node_modules'))) {
    steps.push({ name: 'api-docs: npm ci', command: 'npm', args: ['ci'], cwd: docsDir })
  }
  steps.push({ name: 'api-docs: build', command: 'npm', args: ['run', 'docs:build'], cwd: docsDir })
  steps.push({ name: 'api-docs: check links', command: 'npm', args: ['run', 'docs:check'], cwd: docsDir })
}

const started = Date.now()
for (const [index, step] of steps.entries()) {
  const label = `[${index + 1}/${steps.length}] ${step.name}`
  console.log(`\n=== ${label}: ${step.command} ${step.args.join(' ')}`)
  const result = spawnSync(step.command, step.args, {
    cwd: step.cwd ?? root,
    env: { ...process.env, ...step.env },
    stdio: 'inherit',
  })
  const failure = result.error ? result.error.message
    : result.status !== 0 ? `exited with ${result.status ?? `signal ${result.signal}`}` : null
  if (failure) {
    console.error(`\n${label} failed: ${failure}`)
    process.exit(1)
  }
}
console.log(`\nverify passed (${steps.length} checks${fast ? ', --fast' : ''}) in ${Math.round((Date.now() - started) / 1000)}s`)
