import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Match } from 'aws-cdk-lib/assertions'
import { template, templates, fullContext } from './helpers.ts'

const t = template({ ...fullContext })
const resources = t.toJSON().Resources as Record<string, { Type: string, Properties: any, DeletionPolicy?: string }>
const ofType = (type: string) => Object.entries(resources).filter(([, r]) => r.Type === type)
const taskDefinition = (family: string) => ofType('AWS::ECS::TaskDefinition').map(([, r]) => r.Properties).find(p => p.Family === family)

test('no NAT gateway, two public and two private subnets', () => {
  t.resourceCountIs('AWS::EC2::NatGateway', 0)
  t.resourceCountIs('AWS::EC2::Subnet', 4)
})

test('the database is PostgreSQL 17 on db.t4g.micro, private, encrypted, backed up and protected', () => {
  t.hasResourceProperties('AWS::RDS::DBInstance', {
    Engine: 'postgres',
    EngineVersion: Match.stringLikeRegexp('^17'),
    DBInstanceClass: 'db.t4g.micro',
    MultiAZ: false,
    StorageType: 'gp3',
    AllocatedStorage: '20',
    StorageEncrypted: true,
    BackupRetentionPeriod: 7,
    DeletionProtection: true,
    PubliclyAccessible: false,
    DBName: 'typle',
  })
  const [[, db]] = ofType('AWS::RDS::DBInstance')
  assert.equal(db.DeletionPolicy, 'Snapshot')
})

test('the app and the migration run the images they were given, on ARM64', () => {
  const app = taskDefinition('typle-app')
  assert.equal(app.RuntimePlatform.CpuArchitecture, 'ARM64')
  assert.equal(app.Cpu, '512')
  assert.equal(app.Memory, '1024')
  assert.match(JSON.stringify(app.ContainerDefinitions[0].Image), /:v1\.2\.3"/)
  const migrate = taskDefinition('typle-migrate')
  assert.equal(migrate.RuntimePlatform.CpuArchitecture, 'ARM64')
  assert.match(JSON.stringify(migrate.ContainerDefinitions[0].Image), /:v1\.2\.4"/)
  assert.deepEqual(migrate.ContainerDefinitions[0].Command, ['npm', 'run', 'db:migrate'])
  assert.equal(migrate.ContainerDefinitions[0].WorkingDirectory, '/app/migrate')
})

test('the app gets its settings and its four secrets', () => {
  const container = taskDefinition('typle-app').ContainerDefinitions[0]
  const environment = Object.fromEntries(container.Environment.map((e: { Name: string, Value: string }) => [e.Name, e.Value]))
  assert.deepEqual(environment, {
    AUTH_URL: 'https://typle.sparklingstadt.com',
    SITE_URL: 'https://typle.sparklingstadt.com',
    AUTH_GITHUB_ID: 'gh-client',
    TYPLE_MAIL_FROM: 'Typle <no-reply@example.com>',
  })
  assert.deepEqual(container.Secrets.map((s: { Name: string }) => s.Name).sort(), ['AUTH_GITHUB_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRET', 'DATABASE_URL', 'RESEND_API_KEY'])
  assert.deepEqual(container.PortMappings.map((p: { ContainerPort: number }) => p.ContainerPort), [3000])
})

test('one task behind the load balancer, rolled back when a deployment fails', () => {
  t.hasResourceProperties('AWS::ECS::Service', {
    DesiredCount: 1,
    LaunchType: 'FARGATE',
    NetworkConfiguration: { AwsvpcConfiguration: { AssignPublicIp: 'ENABLED' } },
    DeploymentConfiguration: { DeploymentCircuitBreaker: { Enable: true, Rollback: true }, MinimumHealthyPercent: 100, MaximumPercent: 200 },
  })
})

test('HTTPS on 443 with a certificate, and 80 redirects there for good', () => {
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', { Port: 443, Protocol: 'HTTPS', Certificates: [Match.objectLike({ CertificateArn: Match.anyValue() })] })
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
    Port: 80,
    DefaultActions: [{ Type: 'redirect', RedirectConfig: Match.objectLike({ Protocol: 'HTTPS', Port: '443', StatusCode: 'HTTP_301' }) }],
  })
  t.hasResourceProperties('AWS::CertificateManager::Certificate', { DomainName: 'typle.sparklingstadt.com', ValidationMethod: 'DNS' })
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', { Port: 3000, TargetType: 'ip', HealthCheckPath: '/api/health', Matcher: { HttpCode: '200' } })
})

test('only the load balancer reaches the tasks, and only the tasks reach the database', () => {
  const ingress = ofType('AWS::EC2::SecurityGroupIngress').map(([, r]) => r.Properties)
  const groups = Object.fromEntries(ofType('AWS::EC2::SecurityGroup').map(([id, r]) => [id, r.Properties]))
  const idOf = (description: RegExp) => Object.entries(groups).find(([, p]) => description.test(p.GroupDescription))![0]
  const [alb, tasks, db] = [idOf(/load balancer/i), idOf(/tasks/i), idOf(/database/i)]
  const into = (group: string) => [
    ...ingress.filter(p => p.GroupId?.['Fn::GetAtt']?.[0] === group),
    ...(groups[group].SecurityGroupIngress ?? []),
  ]
  assert.deepEqual(into(tasks).map(p => [p.FromPort, p.ToPort, p.SourceSecurityGroupId?.['Fn::GetAtt']?.[0]]), [[3000, 3000, alb]])
  assert.deepEqual(into(db).map(p => [p.FromPort, p.ToPort, p.SourceSecurityGroupId?.['Fn::GetAtt']?.[0]]), [[5432, 5432, tasks]])
  assert.deepEqual(into(alb).map(p => [p.FromPort, p.CidrIp]).sort(), [[443, '0.0.0.0/0'], [80, '0.0.0.0/0']])
})

test('the app cannot read the master password, the user password or the Neon URL', () => {
  const secretsOf = (role: string) => JSON.stringify(ofType('AWS::IAM::Policy').filter(([, r]) => JSON.stringify(r.Properties.Roles).includes(role)))
  const secretIds = Object.fromEntries(ofType('AWS::SecretsManager::Secret').map(([id, r]) => [r.Properties.Name ?? id, id]))
  const appRole = taskDefinition('typle-app').ExecutionRoleArn['Fn::GetAtt'][0]
  const appPolicies = secretsOf(appRole)
  for (const name of ['typle/APP_DB_PASSWORD', 'typle/NEON_DIRECT_URL']) assert.ok(!appPolicies.includes(secretIds[name]), name)
  const master = ofType('AWS::SecretsManager::Secret').find(([, r]) => JSON.stringify(r.Properties.GenerateSecretString ?? {}).includes('postgres'))![0]
  assert.ok(!appPolicies.includes(master))
  const migratePolicies = secretsOf(taskDefinition('typle-migrate').ExecutionRoleArn['Fn::GetAtt'][0])
  for (const name of ['typle/AUTH_SECRET', 'typle/BETTER_AUTH_SECRET', 'typle/APP_DB_PASSWORD', 'typle/NEON_DIRECT_URL']) assert.ok(!migratePolicies.includes(secretIds[name]), name)
  const movePolicies = secretsOf(taskDefinition('typle-datamove').ExecutionRoleArn['Fn::GetAtt'][0])
  assert.ok(!movePolicies.includes(master), 'datamove connects as the app user')
})

test('the secrets are created as empty shells: no value is in the template', () => {
  for (const [id, secret] of ofType('AWS::SecretsManager::Secret')) assert.equal(secret.Properties.SecretString, undefined, id)
  const names = ofType('AWS::SecretsManager::Secret').map(([, r]) => r.Properties.Name).filter(Boolean).sort()
  assert.deepEqual(names, ['typle/APP_DB_PASSWORD', 'typle/AUTH_GITHUB_SECRET', 'typle/AUTH_SECRET', 'typle/BETTER_AUTH_SECRET', 'typle/DATABASE_URL', 'typle/NEON_DIRECT_URL', 'typle/RESEND_API_KEY'])
})

test('the image repository keeps tags immutable and outlives the stack', () => {
  const [repository] = Object.values(templates(fullContext).base.findResources('AWS::ECR::Repository')) as { Properties: any, DeletionPolicy: string }[]
  assert.equal(repository.Properties.ImageTagMutability, 'IMMUTABLE')
  assert.equal(repository.DeletionPolicy, 'Retain')
  assert.match(repository.Properties.LifecyclePolicy.LifecyclePolicyText, /"countNumber":10/)
})

test('the one-off tasks: the database user and the data move', () => {
  const dbuser = taskDefinition('typle-dbuser').ContainerDefinitions[0]
  assert.match(dbuser.Image, /postgres:17$/)
  const sql = dbuser.Command.join(' ')
  // Rerunnable, and the password is only in an ALTER ROLE that does not fail on a rerun (a failed statement is logged).
  assert.match(sql, /CREATE ROLE typle_app LOGIN' WHERE NOT EXISTS/)
  assert.match(sql, /\\gexec/)
  assert.match(sql, /ALTER ROLE typle_app LOGIN PASSWORD :'pw'/)
  assert.doesNotMatch(sql, /CREATE ROLE typle_app LOGIN PASSWORD/)
  const datamove = taskDefinition('typle-datamove').ContainerDefinitions[0]
  assert.match(datamove.Command.join(' '), /pg_restore --clean --if-exists/)
  const env = Object.fromEntries(datamove.Environment.map((e: { Name: string, Value: string }) => [e.Name, e.Value]))
  assert.equal(env.PGUSER, 'typle_app')
  assert.equal(env.PGSSLMODE, 'require')
})

test('logs are kept 30 days, and five alarms watch the site and the database', () => {
  t.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 30 })
  t.resourceCountIs('AWS::CloudWatch::Alarm', 5)
  t.resourceCountIs('AWS::SNS::Subscription', 0)
  template({ ...fullContext, alarmEmail: 'ops@example.com' }).hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email', Endpoint: 'ops@example.com' })
})

test('what the deploy script reads is in the outputs', () => {
  for (const key of ['ClusterName', 'ServiceName', 'MigrateTaskDefinitionArn', 'DbUserTaskDefinitionArn', 'DataMoveTaskDefinitionArn',
    'TaskSubnetIds', 'TaskSecurityGroupId', 'LoadBalancerDnsName', 'DatabaseEndpoint']) {
    t.hasOutput(key, {})
  }
})

test('the first deploy can start the service with no task, before the secrets and the database are ready', () => {
  template({ ...fullContext, appCount: '0' }).hasResourceProperties('AWS::ECS::Service', { DesiredCount: 0 })
})
