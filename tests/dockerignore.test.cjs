const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// The build context of the Dockerfile. A pattern without **/ matches only at the root of the context, so secrets and
// builds in subfolders (as in .claude/worktrees, whole copies of the repository) need the **/ form.
test('no secret, dependency or build anywhere in the tree reaches the docker build context', () => {
  const lines = fs.readFileSync(path.join(__dirname, '..', '.dockerignore'), 'utf8').split('\n').map(line => line.trim())
  for (const pattern of ['.claude', '**/.env*', '**/*.pem', '**/node_modules', '**/.next', '**/.next-production', '**/.vercel']) {
    assert.ok(lines.includes(pattern), pattern)
  }
})
