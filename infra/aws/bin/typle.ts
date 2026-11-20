import { App } from 'aws-cdk-lib'
import { TypleStack } from '../lib/typle-stack'

// The settings come from cdk.json's context and can be overridden with -c, e.g.
// `npx cdk deploy -c domainName=aws.typle.sparklingstadt.com -c hostedZoneName=sparklingstadt.com` (docs/aws.md).
const app = new App()
const context = (key: string): string | undefined => {
  const value = app.node.tryGetContext(key)
  return typeof value === 'string' && value !== '' ? value : undefined
}

const domainName = context('domainName')
if (!domainName) throw new Error('Set the domain the app is served at: -c domainName=aws.typle.sparklingstadt.com')

new TypleStack(app, 'Typle', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: context('region') ?? 'ap-northeast-1' },
  domainName,
  hostedZoneName: context('hostedZoneName'),
  mailFrom: context('mailFrom'),
  description: 'Typle (typle-r) on ECS Fargate with Amazon RDS for PostgreSQL',
})
