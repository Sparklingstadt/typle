import { test } from 'node:test'
import assert from 'node:assert/strict'
import { App } from 'aws-cdk-lib'
import { readConfig } from '../lib/config.ts'

const app = (context: Record<string, string>) => new App({ context })
const full = { dnsTarget: 'vercel', appTag: 'v1.2.3', githubClientId: 'id', mailFrom: 'Typle <no-reply@example.com>' }

test('the domain and the region are fixed, and the DNS target is read as given', () => {
  const config = readConfig(app(full))
  assert.equal(config.dnsTarget, 'vercel')
  assert.equal(readConfig(app({ ...full, dnsTarget: 'aws' })).dnsTarget, 'aws')
  assert.equal(config.domain, 'typle.sparklingstadt.com')
  assert.equal(config.region, 'ap-northeast-1')
})

test('the DNS target has no default: it comes from infra/cdk.json, so a deploy cannot point the name back by leaving it out', () => {
  const context: Record<string, string> = { ...full }
  delete context.dnsTarget
  assert.throws(() => readConfig(app(context)), /dnsTarget/)
})

test('the migration image is the app image unless given', () => {
  assert.equal(readConfig(app(full)).migrateTag, 'v1.2.3')
  assert.equal(readConfig(app({ ...full, migrateTag: 'v1.2.4' })).migrateTag, 'v1.2.4')
})

test('a deploy needs the image tag, the GitHub client and the mail sender', () => {
  for (const missing of ['appTag', 'githubClientId', 'mailFrom']) {
    const context: Record<string, string> = { ...full }
    delete context[missing]
    assert.throws(() => readConfig(app(context)), new RegExp(missing))
  }
})

test('an unknown DNS target is refused', () => {
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

test('there is no phase any more: no context value leaves resources out of a stack', () => {
  assert.equal((readConfig(app({ ...full, phase: 'dns' })) as Record<string, unknown>).phase, undefined)
})
