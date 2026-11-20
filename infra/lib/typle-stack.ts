import { Stack, type StackProps } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import type { Config } from './config.ts'
import { Dns } from './dns.ts'

/**
 * Production on AWS (docs/superpowers/specs/2026-11-20-aws-migration-design.md). With phase=dns only the hosted zone
 * exists, so that Cloudflare can delegate the name before anything else (the certificate's validation needs it).
 */
export class TypleStack extends Stack {
  readonly dns: Dns

  constructor(scope: Construct, id: string, props: StackProps & { config: Config }) {
    super(scope, id, props)
    this.dns = new Dns(this, 'Dns', { domain: props.config.domain })
  }
}
