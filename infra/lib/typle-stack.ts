import { Stack, type StackProps } from 'aws-cdk-lib'
import { aws_ecr as ecr, aws_route53 as route53 } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { App } from './app.ts'
import type { Config } from './config.ts'
import { Database } from './database.ts'
import { Monitoring } from './monitoring.ts'
import { Network } from './network.ts'

/**
 * Production on AWS (docs/superpowers/specs/2026-11-20-aws-migration-design.md, docs/aws/production.md): the network,
 * the database, the app and its one-off tasks, the load balancer and the alarms. The zone and the image repository
 * come from TypleBase. No context value leaves any of these out, so no deploy can delete them by mistake.
 */
export class TypleStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & {
    config: Config, zone: route53.IHostedZone, repository: ecr.IRepository,
  }) {
    super(scope, id, { ...props, terminationProtection: true })
    const { config } = props
    const network = new Network(this, 'Network')
    const database = new Database(this, 'Database', { vpc: network.vpc, securityGroup: network.databaseGroup })
    const app = new App(this, 'App', {
      config, vpc: network.vpc, zone: props.zone, database: database.instance, repository: props.repository,
      loadBalancerGroup: network.loadBalancerGroup, taskGroup: network.taskGroup,
    })
    new Monitoring(this, 'Monitoring', {
      alarmEmail: config.alarmEmail, loadBalancer: app.loadBalancer, targetGroup: app.targetGroup, database: database.instance,
    })
  }
}
