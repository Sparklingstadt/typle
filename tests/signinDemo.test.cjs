require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { demoFrame, stillStep, HOLD_STEPS } = require('../src/lib/signinDemo.ts')

const words = [{ input: 'abc', meaning: 'A' }, { input: 'あい', meaning: 'B' }]

test('a word is typed one character a step, held, then the next word starts', () => {
  assert.deepEqual(demoFrame(words, 0), { word: words[0], typed: '' })
  assert.deepEqual(demoFrame(words, 2), { word: words[0], typed: 'ab' })
  assert.deepEqual(demoFrame(words, 3), { word: words[0], typed: 'abc' })
  assert.deepEqual(demoFrame(words, 3 + HOLD_STEPS), { word: words[0], typed: 'abc' })
  assert.deepEqual(demoFrame(words, 4 + HOLD_STEPS), { word: words[1], typed: '' })
})

test('characters are counted as code points, and the last word goes back to the first', () => {
  const second = 4 + HOLD_STEPS
  assert.deepEqual(demoFrame(words, second + 1), { word: words[1], typed: 'あ' })
  const total = second + 3 + HOLD_STEPS
  assert.deepEqual(demoFrame(words, total), demoFrame(words, 0))
  assert.equal(demoFrame([{ input: '😀😀', meaning: '' }], 1).typed, '😀')
})

test('the still frame is the first word two thirds typed', () => {
  assert.equal(stillStep([{ input: 'youkoso', meaning: 'ようこそ' }]), 5)
  assert.deepEqual(demoFrame(words, stillStep(words)), { word: words[0], typed: 'ab' })
})
