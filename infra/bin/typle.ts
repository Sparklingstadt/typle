import { App } from 'aws-cdk-lib'
import { readConfig } from '../lib/config.ts'
import { TypleStack } from '../lib/typle-stack.ts'

const app = new App()
const config = readConfig(app)
new TypleStack(app, 'Typle', { env: { region: config.region }, config })
