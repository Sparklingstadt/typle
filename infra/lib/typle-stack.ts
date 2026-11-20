import { Stack, type StackProps } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { App } from './app.ts'
import type { Config } from './config.ts'
import { Database } from './database.ts'
import { Dns } from './dns.ts'
import { Monitoring } from './monitoring.ts'
import { Network } from './network.ts'

/**
 * Production on AWS (docs/superpowers/specs/2026-11-20-aws-migration-design.md, docs/aws/production.md). With
 * phase=dns only the hosted zone exists, so that Cloudflare can delegate the name before the certificate needs it.
 * Never deploy phase=dns once the full stack exists: it would delete everything but the zone (the database keeps a
 * final snapshot and has deletion protection, which makes such a deploy fail first).
 */
export class TypleStack extends Stack {
  readonly dns: Dns

  constructor(scope: Construct, id: string, props: StackProps & { config: Config }) {
    super(scope, id, props)
    const { config } = props
    this.dns = new Dns(this, 'Dns', { domain: config.domain })
    if (config.phase === 'dns') return

    const network = new Network(this, 'Network')
    const database = new Database(this, 'Database', { vpc: network.vpc, securityGroup: network.databaseGroup })
    const app = new App(this, 'App', {
      config, vpc: network.vpc, zone: this.dns.zone, database: database.instance,
      loadBalancerGroup: network.loadBalancerGroup, taskGroup: network.taskGroup,
    })
    new Monitoring(this, 'Monitoring', {
      alarmEmail: config.alarmEmail, loadBalancer: app.loadBalancer, targetGroup: app.targetGroup, database: database.instance,
    })
    if (config.dnsTarget === 'aws') this.dns.aliasToLoadBalancer(app.loadBalancer)
  }
}
