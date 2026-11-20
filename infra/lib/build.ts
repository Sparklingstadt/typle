import type { App } from 'aws-cdk-lib'
import { TypleBaseStack } from './base-stack.ts'
import { readConfig } from './config.ts'
import { TypleStack } from './typle-stack.ts'

/** The two stacks of production, in the one region. */
export function build(app: App): { base: TypleBaseStack, typle: TypleStack } {
  const config = readConfig(app)
  const env = { region: config.region }
  const base = new TypleBaseStack(app, 'TypleBase', { env, config })
  const typle = new TypleStack(app, 'Typle', { env, config, zone: base.dns.zone, repository: base.repository })
  return { base, typle }
}
