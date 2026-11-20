import { App } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { readConfig } from '../lib/config.ts'
import { TypleStack } from '../lib/typle-stack.ts'

export const fullContext = { appTag: 'v1.2.3', migrateTag: 'v1.2.4', githubClientId: 'gh-client', mailFrom: 'Typle <no-reply@example.com>' }

/** The stack as `cdk synth -c …` would make it. */
export function template(context: Record<string, string>): Template {
  const app = new App({ context })
  const config = readConfig(app)
  const stack = new TypleStack(app, 'Typle', { env: { region: config.region }, config })
  return Template.fromStack(stack)
}
