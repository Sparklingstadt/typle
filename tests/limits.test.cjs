require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const limits = require('./fixtures/limits.json')

test('the limits are the ones the backend checks', () => {
  const app = { ...require('../src/lib/devices.ts'), ...require('../src/lib/interests.ts'), ...require('../src/lib/listOverview.ts'),
    ...require('../src/lib/records.ts'), ...require('../src/lib/wordDraft.ts'), ...require('../src/lib/wordFormat.ts'),
    ...require('../src/lib/wordLists.ts'), ...require('../src/lib/wordPacks.ts') }
  assert.deepEqual(Object.fromEntries(Object.keys(limits).map(name => [name, app[name]])), limits)
})
