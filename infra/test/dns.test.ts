import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stacks, templates, fullContext } from './helpers.ts'

test('TypleBase holds the hosted zone, the apex record and the image repository; Typle holds neither zone nor apex', () => {
  const { base, app } = templates(fullContext)
  base.resourceCountIs('AWS::Route53::HostedZone', 1)
  base.hasResourceProperties('AWS::Route53::HostedZone', { Name: 'typle.sparklingstadt.com.' })
  base.resourceCountIs('AWS::ECR::Repository', 1)
  for (const type of ['AWS::RDS::DBInstance', 'AWS::ECS::Service', 'AWS::ElasticLoadBalancingV2::LoadBalancer', 'AWS::EC2::VPC']) {
    base.resourceCountIs(type, 0)
  }
  base.hasOutput('NameServers', {})
  base.hasOutput('RepositoryUri', {})
  app.resourceCountIs('AWS::Route53::HostedZone', 0)
  assert.equal(app.toJSON().Resources.ApexRecord, undefined)
})

test('the apex points at Vercel with a 60-second TTL until the cutover', () => {
  const apex = templates(fullContext).base.toJSON().Resources.ApexRecord
  assert.equal(apex.Type, 'AWS::Route53::RecordSet')
  assert.deepEqual(apex.Properties.ResourceRecords, ['76.76.21.21'])
  assert.equal(apex.Properties.Type, 'A')
  assert.equal(apex.Properties.TTL, '60')
  assert.equal(apex.Properties.Name, 'typle.sparklingstadt.com.')
})

test('the apex stays one record, ApexRecord, and at the cutover aliases the load balancer named in SSM by Typle', () => {
  const { base, app } = templates({ ...fullContext, dnsTarget: 'aws' })
  const apex = base.toJSON().Resources.ApexRecord
  assert.equal(apex.Type, 'AWS::Route53::RecordSet')
  assert.equal(apex.Properties.Type, 'A')
  assert.equal(apex.Properties.ResourceRecords, undefined)
  assert.equal(apex.Properties.TTL, undefined)
  assert.match(JSON.stringify(apex.Properties.AliasTarget), /Ref/)
  const parameters = JSON.stringify(base.toJSON().Parameters)
  assert.match(parameters, /\/typle\/load-balancer\/dns-name/)
  assert.match(parameters, /\/typle\/load-balancer\/hosted-zone-id/)
  app.hasResourceProperties('AWS::SSM::Parameter', { Name: '/typle/load-balancer/dns-name' })
  app.hasResourceProperties('AWS::SSM::Parameter', { Name: '/typle/load-balancer/hosted-zone-id' })
})

test('the zone and the repository outlive their stack, and both stacks are protected from deletion', () => {
  const { base } = templates(fullContext)
  for (const type of ['AWS::Route53::HostedZone', 'AWS::ECR::Repository']) {
    assert.equal(Object.values(base.findResources(type))[0].DeletionPolicy, 'Retain', type)
  }
  const built = stacks(fullContext)
  assert.equal(built.base.terminationProtection, true)
  assert.equal(built.typle.terminationProtection, true)
})
