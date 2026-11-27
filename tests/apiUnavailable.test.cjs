require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { answerWorkspace: answerWorkspaceWith, answerRecords: answerRecordsWith } = require('../src/server/workspace.ts')
const { answerSignOutEverywhere } = require('../src/server/accountApi.ts')
const { readLoginSettings } = require('../src/server/settings.ts')
const { cookieFor, readTestSession } = require('./fakeSession.cjs')
const { failingDb } = require('./fakeDb.cjs')

// What the API answers when the database fails at each point it is used: a 503 with the same key for every cause, and
// the operation in the log (src/server/report.ts) so that the failures of one kind can be found together. No database
// is needed: the databases here are made up (tests/fakeDb.cjs), and answer only the calls a test lets through.

const origin = 'http://127.0.0.1:3104'
const settings = readLoginSettings({ AUTH_SECRET: 'typle-unavailable-test-secret', AUTH_URL: origin })
const withSettings = () => settings
const answerWorkspace = (request, open, settings) => answerWorkspaceWith(request, open, settings, readTestSession)
const answerRecords = (request, open, settings) => answerRecordsWith(request, open, settings, readTestSession)
/** Every use fails. */
const down = () => failingDb()
/** The login is read from the cookie, as the session is made up: every use of the database fails all the same. */
const afterLogin = () => failingDb()
/** No database at all, as when DATABASE_URL is not set. */
const none = () => { throw new Error('DATABASE_URL is not set') }

const github = cookieFor('github:5')

function request(path, method, body, cookie) {
  return new Request(`${origin}${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { Origin: origin, 'Content-Type': 'application/json', 'x-forwarded-for': '192.0.2.1', ...(cookie ? { Cookie: cookie } : {}) },
  })
}

/** The answer of run and what it logged with console.error meanwhile. */
async function answered(run) {
  const original = console.error
  const logged = []
  console.error = (...args) => logged.push(args.map(String).join(' '))
  try {
    return { response: await run(), logged }
  } finally {
    console.error = original
  }
}

/** run answers 503 with key, and reports the failure once as `<method> <path>: <operation>:`. */
async function expectUnavailable(run, key, report) {
  const { response, logged } = await answered(run)
  assert.equal(response.status, 503, report)
  assert.equal(await response.text(), `{"error":"${key}"}\n`, report)
  assert.equal(logged.length, 1, logged.join('\n'))
  assert.ok(logged[0].startsWith(`${report}:`), logged[0])
}

const list = { id: 'l', name: 'L', packId: 'p', words: [{ display: 'a', input: 'a', annotation: '' }], records: [], createdAt: '2026-09-07T00:00:00.000Z' }
const save = { accountId: 'github:5', revision: 0, packs: [{ id: 'p', name: 'P', createdAt: '2026-09-07T00:00:00.000Z' }], lists: [list] }
const run = { id: 'run-1', time: 2.5, date: '2026-10-02T10:00:00.000Z', mistakes: 0, accuracy: 100, wordCount: 1 }

test('/api/workspace is 503 databaseUnavailable when there is no pool or the workspace cannot be read', async () => {
  await expectUnavailable(() => answerWorkspace(request('/api/workspace', 'GET', undefined, github), none, withSettings),
    'databaseUnavailable', 'GET /api/workspace: workspace.open')
  await expectUnavailable(() => answerWorkspace(request('/api/workspace', 'PUT', save, github), none, withSettings),
    'databaseUnavailable', 'PUT /api/workspace: workspace.open')
  await expectUnavailable(() => answerWorkspace(request('/api/workspace', 'GET', undefined, github), afterLogin, withSettings),
    'databaseUnavailable', 'GET /api/workspace: workspace.read')
})

test('a save that cannot be written, or whose body cannot be read, is 503 workspaceSaveFailed', async () => {
  await expectUnavailable(() => answerWorkspace(request('/api/workspace', 'PUT', save, github), afterLogin, withSettings),
    'workspaceSaveFailed', 'PUT /api/workspace: workspace.write')
  // The connection ends while the body is still being sent.
  const cut = new Request(`${origin}/api/workspace`, {
    method: 'PUT', duplex: 'half', body: new ReadableStream({ pull(controller) { controller.error(new Error('the connection was cut')) } }),
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: github },
  })
  await expectUnavailable(() => answerWorkspace(cut, afterLogin, withSettings), 'workspaceSaveFailed', 'PUT /api/workspace: workspace.write')
})

test('/api/workspace/records is 503 when there is no pool or the record cannot be written', async () => {
  const add = { accountId: 'github:5', listId: 'l', record: run }
  const remove = { accountId: 'github:5', listId: 'l', recordId: 'run-1' }
  await expectUnavailable(() => answerRecords(request('/api/workspace/records', 'POST', add, github), none, withSettings),
    'databaseUnavailable', 'POST /api/workspace/records: workspace.open')
  await expectUnavailable(() => answerRecords(request('/api/workspace/records', 'POST', add, github), afterLogin, withSettings),
    'workspaceSaveFailed', 'POST /api/workspace/records: record.add')
  await expectUnavailable(() => answerRecords(request('/api/workspace/records', 'DELETE', remove, github), afterLogin, withSettings),
    'workspaceSaveFailed', 'DELETE /api/workspace/records: record.delete')
})

test('signing out of every device is 503 databaseUnavailable when the session cannot be read or the sessions cannot be deleted', async () => {
  const signOut = () => request('/api/account/signout-everywhere', 'POST', undefined, github)
  const unreadable = async () => { throw new Error('the database is down') }
  await expectUnavailable(() => answerSignOutEverywhere(signOut(), withSettings, unreadable),
    'databaseUnavailable', 'POST /api/account/signout-everywhere: session.check')
  const end = { revokeAll: async () => { throw new Error('the database is down') }, loginCookies: async () => [] }
  await expectUnavailable(() => answerSignOutEverywhere(signOut(), withSettings, readTestSession, end),
    'databaseUnavailable', 'POST /api/account/signout-everywhere: session.revoke')
})

test('the session cannot be read: any workspace request is 503 databaseUnavailable', async () => {
  const unreadable = async () => { throw new Error('the database is down') }
  await expectUnavailable(() => answerWorkspaceWith(request('/api/workspace', 'GET', undefined, github), () => failingDb(), withSettings, unreadable),
    'databaseUnavailable', 'GET /api/workspace: session.check')
})
