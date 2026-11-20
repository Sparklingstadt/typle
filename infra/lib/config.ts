import type { App } from 'aws-cdk-lib'

/**
 * What a deploy is told: dnsTarget by infra/cdk.json, the rest with `cdk deploy -c key=value` (scripts/deploy-aws.cjs
 * passes them from infra/cdk.context.local.json).
 * Nothing secret goes here: the secrets live in Secrets Manager (lib/app.ts).
 */
export type Config = {
  /**
   * Where the zone apex points: Vercel until the cutover, then the load balancer. Committed in infra/cdk.json (no
   * default), so that no deploy can point the name back by leaving it out.
   */
  dnsTarget: 'vercel' | 'aws'
  /** The image tag the service runs (v<package.json version>). */
  appTag?: string
  /** The image tag the migration task runs; the release deploys it before the service (scripts/deploy-aws.cjs). */
  migrateTag?: string
  githubClientId?: string
  /** TYPLE_MAIL_FROM, as "Typle <no-reply@example.com>". */
  mailFrom?: string
  /** Where the alarms are mailed; no subscription without it. */
  alarmEmail?: string
  /** Tasks of the service: 0 only for the first deploy, before the secrets and the database user exist. */
  appCount: 0 | 1
  domain: 'typle.sparklingstadt.com'
  region: 'ap-northeast-1'
}

function choice<T extends string>(app: App, key: string, values: readonly T[], fallback?: T): T {
  const value = app.node.tryGetContext(key) ?? fallback
  if (!values.includes(value)) throw new Error(`${key} must be one of ${values.join(', ')} (got ${value})`)
  return value
}

function optional(app: App, key: string): string | undefined {
  const value = app.node.tryGetContext(key)
  return value === undefined || value === '' ? undefined : String(value)
}

export function readConfig(app: App): Config {
  const config: Config = {
    dnsTarget: choice(app, 'dnsTarget', ['vercel', 'aws'] as const),
    appTag: optional(app, 'appTag'),
    migrateTag: optional(app, 'migrateTag') ?? optional(app, 'appTag'),
    githubClientId: optional(app, 'githubClientId'),
    mailFrom: optional(app, 'mailFrom'),
    alarmEmail: optional(app, 'alarmEmail'),
    appCount: choice(app, 'appCount', ['0', '1'] as const, '1') === '0' ? 0 : 1,
    domain: 'typle.sparklingstadt.com',
    region: 'ap-northeast-1',
  }
  for (const key of ['appTag', 'githubClientId', 'mailFrom'] as const) {
    if (!config[key]) throw new Error(`Pass -c ${key}=…`)
  }
  return config
}
