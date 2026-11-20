require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeLoginId, loginIdProblem, passwordProblem, emailProblem, normalizeEmail } = require('../src/lib/accountRules.ts')

test('an ID is trimmed and lower-cased', () => {
  assert.equal(normalizeLoginId(' Alice '), 'alice')
})

test('an ID of 3 to 32 of a-z 0-9 _ - is accepted, others are not', () => {
  assert.equal(loginIdProblem('abc'), null)
  assert.equal(loginIdProblem('a'.repeat(32)), null)
  for (const bad of ['ab', 'a'.repeat(33), 'a b', 'あいう', 'A_B']) assert.equal(loginIdProblem(bad), 'loginIdFormat', bad)
})

test('a password is 10 to 128 characters and not the ID', () => {
  assert.equal(passwordProblem('short', 'x'), 'passwordLength')
  assert.equal(passwordProblem('a'.repeat(129), 'x'), 'passwordLength')
  assert.equal(passwordProblem('a'.repeat(128), 'x'), null)
  assert.equal(passwordProblem('alice12345', 'alice12345'), 'passwordSameAsId')
  assert.equal(passwordProblem('Alice12345', 'ALICE12345'), 'passwordSameAsId')
  assert.equal(passwordProblem('alice12345', 'bob'), null)
})

test('an address needs one @ and a dot after it, up to 254 characters', () => {
  assert.equal(normalizeEmail(' A@B.com '), 'a@b.com')
  assert.equal(emailProblem('a@b.co'), null)
  for (const bad of ['', 'a@b', 'a b@c.d', '@b.c', `${'a'.repeat(250)}@b.co`]) assert.equal(emailProblem(bad), 'emailFormat', bad)
})
