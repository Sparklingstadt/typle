import type { App } from 'aws-cdk-lib'

/**
 * What a deploy is told with `cdk deploy -c key=value` (or infra/cdk.context.local.json through scripts/deploy-aws.cjs).
 * Nothing secret goes here: the secrets live in Secrets Manager (lib/app.ts).
 */
export type Config = {
  /** dns: only the hosted zone and its records, before Cloudflare delegates the name. full: everything. */
  phase: 'dns' | 'full'
  /** Where the zone apex points: Vercel until the cutover, then the load balancer. */
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
  domain: 'typle.sparklingstadt.com'
  region: 'ap-northeast-1'
}

function choice<T extends string>(app: App, key: string, values: readonly T[], fallback: T): T {
  const value = app.node.tryGetContext(key) ?? fallback
  if (!values.includes(value)) throw new Error(`${key} must be one of ${values.join(', ')} (got ${value})`)
  return value
}

function optional(app: App, key: string): string | undefined {
  const value = app.node.tryGetContext(key)
  return value === undefined || value === '' ? undefined : String(value)
}

export function readConfig(app: App): Config {
  const phase = choice(app, 'phase', ['dns', 'full'] as const, 'full')
  const config: Config = {
    phase,
    dnsTarget: choice(app, 'dnsTarget', ['vercel', 'aws'] as const, 'vercel'),
    appTag: optional(app, 'appTag'),
    migrateTag: optional(app, 'migrateTag') ?? optional(app, 'appTag'),
    githubClientId: optional(app, 'githubClientId'),
    mailFrom: optional(app, 'mailFrom'),
    alarmEmail: optional(app, 'alarmEmail'),
    domain: 'typle.sparklingstadt.com',
    region: 'ap-northeast-1',
  }
  if (phase === 'full') {
    for (const key of ['appTag', 'githubClientId', 'mailFrom'] as const) {
      if (!config[key]) throw new Error(`Pass -c ${key}=… for the full phase`)
    }
  }
  return config
}
