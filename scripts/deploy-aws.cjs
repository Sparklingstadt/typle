// Releases the main commit to production on AWS (docs/aws/production.md): the deploy step of docs/release-workflow.md.
// Run from the repository root on the Mac that publishes, after `npm run verify` and the GitHub Release:
//
//   node scripts/deploy-aws.cjs [--profile typle]
//
// In order, stopping at the first failure (a rerun picks up again: an image already in ECR is not built twice):
//   1. the tree is clean and HEAD is origin/main
//   2. build the ARM64 image v<package.json version> and push it to ECR
//   3. cdk deploy with the new image for the migration task only (the service keeps the image it runs)
//   4. run the migration as a one-off task and require exit code 0
//   5. cdk deploy with the new image for the service too (CloudFormation waits until the service is stable)
//   6. npm run check:production
// The deploy settings that are not secret but not in the repository either (the GitHub OAuth client ID, the mail
// sender, where the apex points, the alarm mail) come from infra/cdk.context.local.json, which git ignores:
//   { "githubClientId": "…", "mailFrom": "Typle <no-reply@…>", "dnsTarget": "vercel" | "aws", "alarmEmail": "…" }
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const infra = path.join(root, 'infra')
const SITE_URL = 'https://typle.sparklingstadt.com'
const STACK = 'Typle'

/** Runs a command and returns its status and output; stdout is captured, stderr goes to the terminal. */
function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    input: options.input,
    encoding: 'utf8',
    stdio: [options.input === undefined ? 'inherit' : 'pipe', options.capture ? 'pipe' : 'inherit', 'inherit'],
  })
  return { status: result.error ? 1 : result.status, stdout: result.stdout ?? '' }
}

/**
 * The release, with every command going through run(command, args, options) so that tests can replace it.
 * Rejects with the step that failed.
 */
async function deploy({ run, version, profile, settings, log = console.log }) {
  for (const key of ['githubClientId', 'mailFrom', 'dnsTarget']) {
    if (!settings[key]) throw new Error(`infra/cdk.context.local.json needs ${key}`)
  }
  const tag = `v${version}`
  const aws = ['--profile', profile, '--region', 'ap-northeast-1', '--output', 'json']
  const must = (command, args, options = {}) => {
    const result = run(command, args, { capture: true, ...options })
    if (result.status !== 0) throw new Error(`Failed: ${[command, ...args].join(' ')}`)
    return result.stdout
  }
  const json = (command, args, options) => JSON.parse(must(command, args, options))

  log('== 1. the commit')
  if (must('git', ['status', '--porcelain']).trim() !== '') throw new Error('The working tree has changes; release a clean main.')
  if (must('git', ['rev-parse', 'HEAD']).trim() !== must('git', ['rev-parse', 'origin/main']).trim()) {
    throw new Error('HEAD is not origin/main: run git switch main && git pull --ff-only first.')
  }

  const outputs = () => Object.fromEntries(
    json('aws', ['cloudformation', 'describe-stacks', '--stack-name', STACK, '--query', 'Stacks[0].Outputs', ...aws])
      .map(output => [output.OutputKey, output.OutputValue]))
  const stack = outputs()
  const image = `${stack.RepositoryUri}:${tag}`

  log(`== 2. the image ${image}`)
  const repositoryName = stack.RepositoryUri.split('/').slice(1).join('/')
  const pushed = run('aws', ['ecr', 'describe-images', '--repository-name', repositoryName, '--image-ids', `imageTag=${tag}`, ...aws], { capture: true }).status === 0
  if (pushed) {
    log('Already in ECR; not built again.')
  } else {
    const password = must('aws', ['ecr', 'get-login-password', ...aws])
    must('docker', ['login', '--username', 'AWS', '--password-stdin', stack.RepositoryUri.split('/')[0]], { input: password })
    must('docker', ['build', '--platform', 'linux/arm64', '--build-arg', `SITE_URL=${SITE_URL}`, '-t', image, '.'], { capture: false })
    must('docker', ['push', image], { capture: false })
  }

  const service = json('aws', ['ecs', 'describe-services', '--cluster', stack.ClusterName, '--services', stack.ServiceName, ...aws]).services[0]
  const running = json('aws', ['ecs', 'describe-task-definition', '--task-definition', service.taskDefinition, ...aws])
    .taskDefinition.containerDefinitions[0].image
  const runningTag = running.slice(running.lastIndexOf(':') + 1)

  const cdkDeploy = appTag => must('npx', ['cdk', 'deploy', STACK, '--require-approval', 'never', '--profile', profile,
    '-c', `appTag=${appTag}`, '-c', `migrateTag=${tag}`,
    '-c', `githubClientId=${settings.githubClientId}`, '-c', `mailFrom=${settings.mailFrom}`, '-c', `dnsTarget=${settings.dnsTarget}`,
    ...(settings.alarmEmail ? ['-c', `alarmEmail=${settings.alarmEmail}`] : [])], { cwd: infra, capture: false })

  log(`== 3. the migration task gets ${tag} (the service keeps ${runningTag})`)
  cdkDeploy(runningTag)

  log('== 4. the migrations')
  const migrate = outputs().MigrateTaskDefinitionArn
  const network = `awsvpcConfiguration={subnets=[${stack.TaskSubnetIds}],securityGroups=[${stack.TaskSecurityGroupId}],assignPublicIp=ENABLED}`
  const started = json('aws', ['ecs', 'run-task', '--cluster', stack.ClusterName, '--task-definition', migrate,
    '--launch-type', 'FARGATE', '--network-configuration', network, ...aws])
  const taskArn = started.tasks?.[0]?.taskArn
  if (!taskArn) throw new Error(`The migration task did not start: ${JSON.stringify(started.failures)}`)
  must('aws', ['ecs', 'wait', 'tasks-stopped', '--cluster', stack.ClusterName, '--tasks', taskArn, ...aws])
  const exitCode = json('aws', ['ecs', 'describe-tasks', '--cluster', stack.ClusterName, '--tasks', taskArn, ...aws]).tasks[0].containers[0].exitCode
  if (exitCode !== 0) throw new Error(`The migration task exited with ${exitCode}; see /ecs/typle (stream migrate/…). The service still runs ${runningTag}.`)

  log(`== 5. the service gets ${tag}`)
  cdkDeploy(tag)

  log('== 6. check:production')
  must('npm', ['run', 'check:production'], { capture: false })
  log(`Released ${tag}.`)
}

if (require.main === module) {
  const at = process.argv.indexOf('--profile')
  const profile = at >= 0 ? process.argv[at + 1] : 'typle'
  const settingsFile = path.join(infra, 'cdk.context.local.json')
  const settings = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {}
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  deploy({ run: runCommand, version, profile, settings }).catch(error => {
    console.error(`\n${error.message}`)
    process.exit(1)
  })
}

module.exports = { deploy }
