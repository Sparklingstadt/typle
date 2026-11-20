const { test } = require('node:test')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const path = require('node:path')

async function config(env) {
  const saved = process.env.TYPLE_STANDALONE
  if (env === undefined) delete process.env.TYPLE_STANDALONE
  else process.env.TYPLE_STANDALONE = env
  try {
    const url = `${pathToFileURL(path.join(__dirname, '..', 'next.config.mjs'))}?t=${Date.now()}-${Math.random()}`
    return (await import(url)).default('phase-production-build')
  } finally {
    if (saved === undefined) delete process.env.TYPLE_STANDALONE
    else process.env.TYPLE_STANDALONE = saved
  }
}

test('the container build is standalone, every other build is as before', async () => {
  assert.equal((await config('1')).output, 'standalone')
  assert.equal((await config(undefined)).output, undefined)
  assert.equal((await config('0')).output, undefined)
})
