import { test } from 'node:test'
import assert from 'node:assert/strict'
import { template } from './helpers.ts'

test('the dns phase makes the hosted zone and points the apex at Vercel, and nothing else', () => {
  const t = template({ phase: 'dns' })
  t.resourceCountIs('AWS::Route53::HostedZone', 1)
  t.hasResourceProperties('AWS::Route53::HostedZone', { Name: 'typle.sparklingstadt.com.' })
  const apex = t.toJSON().Resources.ApexRecord
  assert.equal(apex.Type, 'AWS::Route53::RecordSet')
  assert.deepEqual(apex.Properties.ResourceRecords, ['76.76.21.21'])
  assert.equal(apex.Properties.Type, 'A')
  assert.equal(apex.Properties.TTL, '60')
  assert.equal(apex.Properties.Name, 'typle.sparklingstadt.com.')
  for (const type of ['AWS::RDS::DBInstance', 'AWS::ECS::Service', 'AWS::ElasticLoadBalancingV2::LoadBalancer', 'AWS::EC2::VPC']) {
    t.resourceCountIs(type, 0)
  }
  t.hasOutput('NameServers', {})
})

test('the zone is kept even if the stack is deleted', () => {
  const zone = Object.values(template({ phase: 'dns' }).findResources('AWS::Route53::HostedZone'))[0]
  assert.equal(zone.DeletionPolicy, 'Retain')
})
