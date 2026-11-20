import { App } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { build } from '../lib/build.ts'

export const fullContext = {
  dnsTarget: 'vercel', appTag: 'v1.2.3', migrateTag: 'v1.2.4', githubClientId: 'gh-client', mailFrom: 'Typle <no-reply@example.com>',
}

/** Both stacks as `cdk synth -c …` (with infra/cdk.json's context) would make them. */
export function templates(context: Record<string, string>): { base: Template, app: Template } {
  const { base, typle } = stacks(context)
  return { base: Template.fromStack(base), app: Template.fromStack(typle) }
}

export const stacks = (context: Record<string, string>) => build(new App({ context }))

/** The app stack (Typle). */
export const template = (context: Record<string, string>) => templates(context).app
