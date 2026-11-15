const { test } = require('node:test')
const assert = require('node:assert/strict')
const strings = require('./fixtures/strings.json')

// The same cases are read by server/internal/workspace, whose lowerCase and trimJS copy what JavaScript does: the
// expected values here are checked against JavaScript itself, so the fixture cannot drift from it.
test('lowerCase cases are what JavaScript gives', () => {
  for (const { input, want } of strings.lowerCase) assert.equal(input.toLowerCase(), want, JSON.stringify(input))
})

test('trim cases are what JavaScript gives', () => {
  for (const { input, want } of strings.trim) assert.equal(input.trim(), want, JSON.stringify(input))
})
