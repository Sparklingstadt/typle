require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateWorkspaceRequest } = require('../src/core/workspaceRequest.ts')
const { cases } = require('./fixtures/workspace-put.json')

test('save bodies are accepted and refused as the backend does', () => {
  for (const c of cases) {
    let change
    try { change = validateWorkspaceRequest(JSON.parse(c.body)) } catch { change = undefined }
    assert.equal(change !== undefined, c.accepted, c.name)
    if (!change) continue
    // -0 is revision 0, as JSON.parse gives it for "-0".
    assert.ok(change.revision === c.revision, c.name)
    assert.equal(change.lists ? change.lists.length : -1, c.lists, c.name)
    assert.equal(change.devices ? change.devices.length : -1, c.devices, c.name)
  }
})
