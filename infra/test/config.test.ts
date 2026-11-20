import { test } from 'node:test'
import assert from 'node:assert/strict'
import { App } from 'aws-cdk-lib'
import { readConfig } from '../lib/config.ts'

const app = (context: Record<string, string>) => new App({ context })
const full = { appTag: 'v1.2.3', githubClientId: 'id', mailFrom: 'Typle <no-reply@example.com>' }

test('phase is full and the apex points at Vercel unless told otherwise', () => {
  const config = readConfig(app(full))
  assert.equal(config.phase, 'full')
  assert.equal(config.dnsTarget, 'vercel')
  assert.equal(config.domain, 'typle.sparklingstadt.com')
  assert.equal(config.region, 'ap-northeast-1')
})

test('the migration image is the app image unless given', () => {
  assert.equal(readConfig(app(full)).migrateTag, 'v1.2.3')
  assert.equal(readConfig(app({ ...full, migrateTag: 'v1.2.4' })).migrateTag, 'v1.2.4')
})

test('the full phase needs the image tag, the GitHub client and the mail sender', () => {
  for (const missing of ['appTag', 'githubClientId', 'mailFrom']) {
    const context: Record<string, string> = { ...full }
    delete context[missing]
    assert.throws(() => readConfig(app(context)), new RegExp(missing))
  }
})

test('the dns phase needs nothing else', () => {
  const config = readConfig(app({ phase: 'dns' }))
  assert.equal(config.phase, 'dns')
  assert.equal(config.appTag, undefined)
})

test('an unknown phase or DNS target is refused', () => {
  assert.throws(() => readConfig(app({ ...full, phase: 'Full' })), /phase/)
  assert.throws(() => readConfig(app({ ...full, dnsTarget: 'cloudflare' })), /dnsTarget/)
})

test('the alarm mail is optional', () => {
  assert.equal(readConfig(app(full)).alarmEmail, undefined)
  assert.equal(readConfig(app({ ...full, alarmEmail: 'ops@example.com' })).alarmEmail, 'ops@example.com')
})

test('the service runs one task unless the first deploy asks for none', () => {
  assert.equal(readConfig(app(full)).appCount, 1)
  assert.equal(readConfig(app({ ...full, appCount: '0' })).appCount, 0)
  assert.throws(() => readConfig(app({ ...full, appCount: '2' })), /appCount/)
})

test('the apex cannot point at a load balancer the dns phase does not make', () => {
  assert.throws(() => readConfig(app({ phase: 'dns', dnsTarget: 'aws' })), /dnsTarget/)
})
