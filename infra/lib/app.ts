import { readFileSync } from 'node:fs'
import { CfnOutput, Duration, Fn, RemovalPolicy } from 'aws-cdk-lib'
import {
  aws_certificatemanager as acm, aws_ec2 as ec2, aws_ecr as ecr, aws_ecs as ecs,
  aws_elasticloadbalancingv2 as elbv2, aws_logs as logs, aws_rds as rds, aws_route53 as route53,
  aws_secretsmanager as secretsmanager, aws_ssm as ssm,
} from 'aws-cdk-lib'
import { LOAD_BALANCER_PARAMETERS } from './dns.ts'
import { Construct } from 'constructs'
import type { Config } from './config.ts'

const POSTGRES_IMAGE = 'public.ecr.aws/docker/library/postgres:17'

/** Creates typle_app or sets its password to APP_PASSWORD (a psql variable, never in the command) and grants it the database. */
const CREATE_APP_USER = [
  'printf \'%s\\n\'',
  // Rerunnable: the role is created without a password if missing, then given the password. A failed statement goes
  // to the server log with its text, so the password is only in a statement that does not fail on a rerun.
  '"SELECT \'CREATE ROLE typle_app LOGIN\' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = \'typle_app\') \\gexec"',
  '"ALTER ROLE typle_app LOGIN PASSWORD :\'pw\';"',
  '"GRANT ALL ON DATABASE typle TO typle_app;"',
  '"GRANT ALL ON SCHEMA public TO typle_app;"',
  '| psql -v ON_ERROR_STOP=1 -v pw="$APP_PASSWORD"',
].join(' ')

type Secrets = Record<'databaseUrl' | 'authSecret' | 'githubSecret' | 'resendApiKey' | 'appDbPassword' | 'neonDirectUrl', secretsmanager.Secret>

/**
 * The secrets, and on the cluster: the app's service behind the load balancer, and three task
 * definitions run as one-off tasks (the migrations, creating the app's database user, copying the data from Neon).
 * Each task definition has its own execution role, which may read only the secrets that task is given.
 */
export class App extends Construct {
  readonly loadBalancer: elbv2.ApplicationLoadBalancer
  readonly targetGroup: elbv2.ApplicationTargetGroup
  readonly service: ecs.FargateService

  constructor(scope: Construct, id: string, props: {
    config: Config, vpc: ec2.IVpc, zone: route53.IHostedZone, database: rds.DatabaseInstance, repository: ecr.IRepository,
    loadBalancerGroup: ec2.ISecurityGroup, taskGroup: ec2.ISecurityGroup,
  }) {
    super(scope, id)
    const { config, vpc, database } = props
    const site = `https://${config.domain}`

    const { repository } = props

    // Created with a random placeholder; the real values are put with `aws secretsmanager put-secret-value`.
    const secret = (key: string, name: string, description: string) =>
      new secretsmanager.Secret(this, key, { secretName: `typle/${name}`, description })
    const secrets: Secrets = {
      databaseUrl: secret('DatabaseUrl', 'DATABASE_URL', 'postgresql://typle_app:…@<endpoint>:5432/typle?sslmode=verify-full&sslrootcert=/app/certs/rds-global-bundle.pem'),
      authSecret: secret('AuthSecret', 'AUTH_SECRET', 'The same AUTH_SECRET as production on Vercel, so sessions and mail links stay valid'),
      githubSecret: secret('GithubSecret', 'AUTH_GITHUB_SECRET', 'The client secret of the GitHub OAuth App'),
      resendApiKey: secret('ResendApiKey', 'RESEND_API_KEY', 'The Resend API key that sends the mails'),
      appDbPassword: secret('AppDbPassword', 'APP_DB_PASSWORD', 'The password of typle_app (letters and digits only), also in DATABASE_URL'),
      neonDirectUrl: secret('NeonDirectUrl', 'NEON_DIRECT_URL', 'The direct (not pooled) connection to Neon, for the data move only'),
    }

    const logGroup = new logs.LogGroup(this, 'Logs', {
      logGroupName: '/ecs/typle',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.RETAIN,
    })
    const logging = (prefix: string) => ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: prefix })
    const arm64 = { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX }
    const fromSecret = (s: secretsmanager.ISecret, field?: string) => ecs.Secret.fromSecretsManager(s, field)

    const cluster = new ecs.Cluster(this, 'Cluster', { vpc, clusterName: 'typle' })

    const app = new ecs.FargateTaskDefinition(this, 'AppTask', { family: 'typle-app', cpu: 512, memoryLimitMiB: 1024, runtimePlatform: arm64 })
    app.addContainer('app', {
      image: ecs.ContainerImage.fromEcrRepository(repository, config.appTag),
      portMappings: [{ containerPort: 3000 }],
      environment: {
        AUTH_URL: site,
        SITE_URL: site,
        AUTH_GITHUB_ID: config.githubClientId!,
        TYPLE_MAIL_FROM: config.mailFrom!,
      },
      secrets: {
        DATABASE_URL: fromSecret(secrets.databaseUrl),
        AUTH_SECRET: fromSecret(secrets.authSecret),
        AUTH_GITHUB_SECRET: fromSecret(secrets.githubSecret),
        RESEND_API_KEY: fromSecret(secrets.resendApiKey),
      },
      logging: logging('app'),
    })

    const migrate = new ecs.FargateTaskDefinition(this, 'MigrateTask', { family: 'typle-migrate', cpu: 256, memoryLimitMiB: 512, runtimePlatform: arm64 })
    migrate.addContainer('migrate', {
      image: ecs.ContainerImage.fromEcrRepository(repository, config.migrateTag),
      // The image's /app/migrate (Dockerfile): scripts/check-migrations.cjs, then prisma migrate deploy.
      command: ['npm', 'run', 'db:migrate'],
      workingDirectory: '/app/migrate',
      secrets: { DATABASE_URL: fromSecret(secrets.databaseUrl) },
      logging: logging('migrate'),
    })

    // The postgres image has no RDS CA bundle: these connect with sslmode=require (encrypted, inside the VPC).
    const libpq = { PGHOST: database.dbInstanceEndpointAddress, PGDATABASE: 'typle', PGSSLMODE: 'require' }

    const dbuser = new ecs.FargateTaskDefinition(this, 'DbUserTask', { family: 'typle-dbuser', cpu: 256, memoryLimitMiB: 512, runtimePlatform: arm64 })
    dbuser.addContainer('psql', {
      image: ecs.ContainerImage.fromRegistry(POSTGRES_IMAGE),
      command: ['sh', '-c', CREATE_APP_USER],
      environment: { ...libpq, PGUSER: 'postgres' },
      secrets: { PGPASSWORD: fromSecret(database.secret!, 'password'), APP_PASSWORD: fromSecret(secrets.appDbPassword) },
      logging: logging('dbuser'),
    })

    const datamove = new ecs.FargateTaskDefinition(this, 'DataMoveTask', { family: 'typle-datamove', cpu: 512, memoryLimitMiB: 1024, runtimePlatform: arm64 })
    datamove.addContainer('datamove', {
      image: ecs.ContainerImage.fromRegistry(POSTGRES_IMAGE),
      command: ['sh', '-c', readFileSync(new URL('./datamove.sh', import.meta.url), 'utf8')],
      environment: { ...libpq, PGUSER: 'typle_app' },
      secrets: { PGPASSWORD: fromSecret(secrets.appDbPassword), NEON_DIRECT_URL: fromSecret(secrets.neonDirectUrl) },
      logging: logging('datamove'),
    })

    this.service = new ecs.FargateService(this, 'Service', {
      cluster,
      serviceName: 'app',
      taskDefinition: app,
      desiredCount: config.appCount,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [props.taskGroup],
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      healthCheckGracePeriod: Duration.seconds(60),
    })

    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc,
      internetFacing: true,
      securityGroup: props.loadBalancerGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    })
    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: config.domain,
      validation: acm.CertificateValidation.fromDns(props.zone),
    })
    const https = this.loadBalancer.addListener('Https', { port: 443, certificates: [certificate] })
    this.targetGroup = https.addTargets('App', {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [this.service.loadBalancerTarget({ containerName: 'app', containerPort: 3000 })],
      healthCheck: { path: '/api/health', healthyHttpCodes: '200' },
      deregistrationDelay: Duration.seconds(30),
    })
    this.loadBalancer.addRedirect({ sourcePort: 80, targetPort: 443 })
    // TypleBase reads these at the cutover (dnsTarget=aws) to alias the apex.
    new ssm.StringParameter(this, 'LoadBalancerDnsNameParameter', {
      parameterName: LOAD_BALANCER_PARAMETERS.dnsName, stringValue: this.loadBalancer.loadBalancerDnsName,
    })
    new ssm.StringParameter(this, 'LoadBalancerZoneIdParameter', {
      parameterName: LOAD_BALANCER_PARAMETERS.hostedZoneId, stringValue: this.loadBalancer.loadBalancerCanonicalHostedZoneId,
    })

    const output = (key: string, value: string) => new CfnOutput(this, key, { key, value })
    output('ClusterName', cluster.clusterName)
    output('ServiceName', this.service.serviceName)
    output('MigrateTaskDefinitionArn', migrate.taskDefinitionArn)
    output('DbUserTaskDefinitionArn', dbuser.taskDefinitionArn)
    output('DataMoveTaskDefinitionArn', datamove.taskDefinitionArn)
    output('TaskSubnetIds', Fn.join(',', vpc.publicSubnets.map(subnet => subnet.subnetId)))
    output('TaskSecurityGroupId', props.taskGroup.securityGroupId)
    output('LoadBalancerDnsName', this.loadBalancer.loadBalancerDnsName)
    output('DatabaseEndpoint', database.dbInstanceEndpointAddress)
  }
}
