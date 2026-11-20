require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { scrypt } = require('node:crypto')
const { hashPassword, verifyPassword } = require('../src/server/password.ts')

/** The real scrypt, counting its calls. */
function counting() {
  const counter = { calls: 0 }
  const derive = (password, salt, length, options) => {
    counter.calls += 1
    return new Promise((resolve, reject) => scrypt(password, salt, length, options, (e, k) => (e ? reject(e) : resolve(k))))
  }
  return { counter, derive }
}

test('a hash has the stored shape and a fresh salt', async () => {
  const a = await hashPassword('correct horse')
  const b = await hashPassword('correct horse')
  assert.match(a, /^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/)
  assert.notEqual(a, b)
})

test('verifyPassword runs scrypt once for a right, a wrong and a missing hash', async () => {
  const stored = await hashPassword('correct horse')
  for (const [password, hash, expected] of [
    ['correct horse', stored, true],
    ['wrong horse', stored, false],
    ['correct horse', null, false],
    ['correct horse', 'garbage', false],
  ]) {
    const { counter, derive } = counting()
    assert.equal(await verifyPassword(password, hash, derive), expected)
    assert.equal(counter.calls, 1)
  }
})
