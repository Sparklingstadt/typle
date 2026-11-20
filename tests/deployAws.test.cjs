const { test } = require('node:test')
const assert = require('node:assert/strict')
const { deploy } = require('../scripts/deploy-aws.cjs')

const outputs = {
  ClusterName: 'typle', ServiceName: 'app', RepositoryUri: '111.dkr.ecr.ap-northeast-1.amazonaws.com/typle',
  MigrateTaskDefinitionArn: 'arn:migrate:7', TaskSubnetIds: 'subnet-a,subnet-b', TaskSecurityGroupId: 'sg-tasks',
}
const settings = { githubClientId: 'gh', mailFrom: 'Typle <no-reply@example.com>', dnsTarget: 'aws' }

/** A fake of the commands: records each call, and answers the ones whose output the deploy reads. */
function fake({ dirty = false, behind = false, imageExists = false, migrateExit = 0, failOn } = {}) {
  const calls = []
  const run = (command, args, options = {}) => {
    const line = [command, ...args].join(' ')
    calls.push(line)
    const ok = stdout => ({ status: failOn && line.includes(failOn) ? 1 : 0, stdout })
    if (line === 'git status --porcelain') return ok(dirty ? ' M src/x.ts\n' : '')
    if (line === 'git rev-parse HEAD') return ok('aaa\n')
    if (line === 'git rev-parse origin/main') return ok(behind ? 'bbb\n' : 'aaa\n')
    if (line.includes('cloudformation describe-stacks')) {
      return ok(JSON.stringify(Object.entries(outputs).map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue }))))
    }
    if (line.includes('ecr describe-images')) return { status: imageExists ? 0 : 254, stdout: '' }
    if (line.includes('ecr get-login-password')) return ok('token')
    if (line.includes('ecs describe-services')) return ok(JSON.stringify({ services: [{ taskDefinition: 'arn:app:3' }] }))
    if (line.includes('ecs describe-task-definition')) {
      return ok(JSON.stringify({ taskDefinition: { containerDefinitions: [{ image: `${outputs.RepositoryUri}:v2.55.1` }] } }))
    }
    if (line.includes('ecs run-task')) return ok(JSON.stringify({ tasks: [{ taskArn: 'arn:task:1' }], failures: [] }))
    if (line.includes('ecs describe-tasks')) return ok(JSON.stringify({ tasks: [{ containers: [{ exitCode: migrateExit }] }] }))
    return ok('')
  }
  return { calls, run }
}

const options = { version: '2.55.2', profile: 'typle', settings, log: () => {} }
const index = (calls, part) => calls.findIndex(call => call.includes(part))

test('a release builds and pushes, migrates with the new image while the service keeps the old one, then updates the service', async () => {
  const { calls, run } = fake()
  await deploy({ ...options, run })
  const build = index(calls, 'docker build')
  const push = index(calls, 'docker push')
  const first = calls.findIndex(call => call.includes('cdk deploy') && call.includes('appTag=v2.55.1') && call.includes('migrateTag=v2.55.2'))
  const migrate = index(calls, 'ecs run-task')
  const wait = index(calls, 'ecs wait tasks-stopped')
  const second = calls.findIndex(call => call.includes('cdk deploy') && call.includes('appTag=v2.55.2') && call.includes('migrateTag=v2.55.2'))
  const check = index(calls, 'check:production')
  for (const [name, at] of Object.entries({ build, push, first, migrate, wait, second, check })) assert.ok(at >= 0, name)
  assert.deepEqual([build, push, first, migrate, wait, second, check], [build, push, first, migrate, wait, second, check].toSorted((a, b) => a - b))
  assert.match(calls[build], /--platform linux\/arm64/)
  assert.match(calls[build], /--build-arg SITE_URL=https:\/\/typle\.sparklingstadt\.com/)
  assert.match(calls[build], /-t 111\.dkr\.ecr\.ap-northeast-1\.amazonaws\.com\/typle:v2\.55\.2/)
  assert.match(calls[migrate], /--task-definition arn:migrate:7/)
  assert.match(calls[migrate], /subnets=\[subnet-a,subnet-b\],securityGroups=\[sg-tasks\],assignPublicIp=ENABLED/)
  for (const at of [first, second]) {
    assert.match(calls[at], /-c dnsTarget=aws/)
    assert.match(calls[at], /-c githubClientId=gh/)
    assert.match(calls[at], /--profile typle/)
  }
})

test('a failed migration stops before the service changes', async () => {
  const { calls, run } = fake({ migrateExit: 1 })
  await assert.rejects(deploy({ ...options, run }), /migration/i)
  assert.equal(calls.filter(call => call.includes('cdk deploy')).length, 1)
  assert.equal(index(calls, 'check:production'), -1)
})

test('nothing runs from a dirty tree or a commit that is not origin/main', async () => {
  for (const state of [{ dirty: true }, { behind: true }]) {
    const { calls, run } = fake(state)
    await assert.rejects(deploy({ ...options, run }))
    assert.equal(calls.filter(call => /docker|cdk|ecs run-task/.test(call)).length, 0, JSON.stringify(state))
  }
})

test('an image already pushed is not built again, so a failed release can be retried', async () => {
  const { calls, run } = fake({ imageExists: true })
  await deploy({ ...options, run })
  assert.equal(index(calls, 'docker build'), -1)
  assert.ok(index(calls, 'ecs run-task') >= 0)
})

test('any failing command stops the release', async () => {
  const { calls, run } = fake({ failOn: 'docker push' })
  await assert.rejects(deploy({ ...options, run }), /docker push/)
  assert.equal(index(calls, 'cdk deploy'), -1)
})

test('the deploy settings must name the GitHub client, the mail sender and the DNS target', async () => {
  for (const key of ['githubClientId', 'mailFrom', 'dnsTarget']) {
    const partial = { ...settings }
    delete partial[key]
    const { calls, run } = fake()
    await assert.rejects(deploy({ ...options, settings: partial, run }), new RegExp(key))
    assert.equal(calls.length, 0)
  }
})
