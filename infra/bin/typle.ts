import { App, Stack } from 'aws-cdk-lib'
import { readConfig } from '../lib/config.ts'

const app = new App()
const config = readConfig(app)
new Stack(app, 'Typle', { env: { region: config.region } })
