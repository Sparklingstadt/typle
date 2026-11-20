import * as path from 'node:path'
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib'
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import { Platform } from 'aws-cdk-lib/aws-ecr-assets'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns'
import { ApplicationProtocol, SslPolicy } from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as rds from 'aws-cdk-lib/aws-rds'
import { HostedZone } from 'aws-cdk-lib/aws-route53'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import type { Construct } from 'constructs'

export interface TypleStackProps extends StackProps {
  /** The domain the app is served at, e.g. aws.typle.sparklingstadt.com. AUTH_URL is https:// and this domain. */
  domainName: string
  /**
   * A Route 53 hosted zone of the domain, e.g. sparklingstadt.com. With it the certificate is validated and the domain
   * pointed at the load balancer automatically; without it both records are added by hand at the DNS provider.
   */
  hostedZoneName?: string
  /** TYPLE_MAIL_FROM, e.g. "Typle <no-reply@example.com>". Without it no mail is sent. */
  mailFrom?: string
}

// The database password goes into DATABASE_URL as it is (scripts/docker-entrypoint.sh), so it has no character that a
// URL would need escaped.
const urlUnsafe = ' %+~`#$&*()|[]{}:;<>?!\'/@"\\,=^'

/**
 * Typle on AWS: the Next.js server (the repository's Dockerfile) on ECS Fargate behind an Application Load Balancer
 * with HTTPS, and Amazon RDS for PostgreSQL. To keep the cost down there is no NAT gateway: the tasks run in public
 * subnets with a public address (only the load balancer may reach them), and the database in isolated subnets, which
 * only the tasks and the database tool may reach.
 */
export class TypleStack extends Stack {
  constructor(scope: Construct, id: string, props: TypleStackProps) {
    super(scope, id, props)
    const { domainName } = props

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'database', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    })

    const database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_17 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      credentials: rds.Credentials.fromGeneratedSecret('typle', {
        secretName: 'typle/database',
        excludeCharacters: urlUnsafe,
      }),
      databaseName: 'typle',
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: false,
      publiclyAccessible: false,
      backupRetention: Duration.days(7),
      deletionProtection: true,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: logs.RetentionDays.ONE_MONTH,
    })
    // PostgreSQL 15 and later on RDS refuse connections without TLS (rds.force_ssl); the app verifies the certificate
    // with Amazon RDS's certificate authorities, which the Dockerfile adds.
    const databaseSecret = database.secret!

    // The app's own secrets. AUTH_SECRET is generated; the GitHub OAuth App and Resend are filled in after the first
    // deployment (docs/aws.md). Left empty, GitHub sign-in is unavailable and no mail is sent.
    const appSecret = new secretsmanager.Secret(this, 'AppSecret', {
      secretName: 'typle/app',
      description: 'Typle: AUTH_SECRET, AUTH_GITHUB_ID, AUTH_GITHUB_SECRET and RESEND_API_KEY',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ AUTH_GITHUB_ID: '', AUTH_GITHUB_SECRET: '', RESEND_API_KEY: '' }),
        generateStringKey: 'AUTH_SECRET',
        passwordLength: 48,
        excludePunctuation: true,
      },
    })

    const zone = props.hostedZoneName ? HostedZone.fromLookup(this, 'Zone', { domainName: props.hostedZoneName }) : undefined
    const certificate = new Certificate(this, 'Certificate', {
      domainName,
      validation: zone ? CertificateValidation.fromDns(zone) : CertificateValidation.fromDns(),
    })

    const cluster = new ecs.Cluster(this, 'Cluster', { vpc, clusterName: 'typle' })

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'Web', {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    })
    const fromDatabase = (field: string) => ecs.Secret.fromSecretsManager(databaseSecret, field)
    const fromApp = (field: string) => ecs.Secret.fromSecretsManager(appSecret, field)
    taskDefinition.addContainer('web', {
      // The repository root: `cdk deploy` builds the Dockerfile there and pushes the image.
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, '..', '..', '..'), { platform: Platform.LINUX_ARM64 }),
      portMappings: [{ containerPort: 3000 }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'web',
        logGroup: new logs.LogGroup(this, 'WebLogs', {
          logGroupName: '/typle/web',
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
      }),
      environment: {
        AUTH_URL: `https://${domainName}`,
        SITE_URL: `https://${domainName}`,
        DB_SSLMODE: 'verify-full',
        ...(props.mailFrom ? { TYPLE_MAIL_FROM: props.mailFrom } : {}),
      },
      secrets: {
        DB_HOST: fromDatabase('host'),
        DB_PORT: fromDatabase('port'),
        DB_NAME: fromDatabase('dbname'),
        DB_USER: fromDatabase('username'),
        DB_PASSWORD: fromDatabase('password'),
        AUTH_SECRET: fromApp('AUTH_SECRET'),
        AUTH_GITHUB_ID: fromApp('AUTH_GITHUB_ID'),
        AUTH_GITHUB_SECRET: fromApp('AUTH_GITHUB_SECRET'),
        RESEND_API_KEY: fromApp('RESEND_API_KEY'),
      },
    })

    const web = new ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster,
      serviceName: 'typle-web',
      taskDefinition,
      desiredCount: 1,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      publicLoadBalancer: true,
      assignPublicIp: true,
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      protocol: ApplicationProtocol.HTTPS,
      certificate,
      sslPolicy: SslPolicy.RECOMMENDED_TLS,
      redirectHTTP: true,
      ...(zone ? { domainName, domainZone: zone } : {}),
      circuitBreaker: { enable: true, rollback: true },
      // The migrations run before the server starts (scripts/docker-entrypoint.sh).
      healthCheckGracePeriod: Duration.seconds(120),
      enableExecuteCommand: true,
    })
    // 200 only once the database answers (src/server/health.ts): a task that cannot reach it is replaced, and a
    // deployment that cannot is rolled back.
    web.targetGroup.configureHealthCheck({ path: '/api/health', healthyHttpCodes: '200', interval: Duration.seconds(30) })
    web.targetGroup.setAttribute('deregistration_delay.timeout_seconds', '30')
    database.connections.allowDefaultPortFrom(web.service, 'Typle web tasks')

    // A task to work on the database by hand (copying the data from Neon, psql), which runs `sleep` and is entered with
    // ECS Exec. Started only when needed (docs/aws.md).
    const toolSecurityGroup = new ec2.SecurityGroup(this, 'DbToolSecurityGroup', { vpc, description: 'Typle database tool task' })
    database.connections.allowDefaultPortFrom(toolSecurityGroup, 'Typle database tool task')
    const tool = new ecs.FargateTaskDefinition(this, 'DbTool', {
      family: 'typle-db-tool',
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    })
    tool.addContainer('psql', {
      image: ecs.ContainerImage.fromRegistry('public.ecr.aws/docker/library/postgres:17-alpine'),
      command: ['sleep', '7200'],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'db-tool', logRetention: logs.RetentionDays.ONE_WEEK }),
      environment: { PGSSLMODE: 'require' },
      secrets: {
        PGHOST: fromDatabase('host'),
        PGPORT: fromDatabase('port'),
        PGDATABASE: fromDatabase('dbname'),
        PGUSER: fromDatabase('username'),
        PGPASSWORD: fromDatabase('password'),
      },
    })
    tool.addToTaskRolePolicy(new iam.PolicyStatement({
      actions: ['ssmmessages:CreateControlChannel', 'ssmmessages:CreateDataChannel', 'ssmmessages:OpenControlChannel', 'ssmmessages:OpenDataChannel'],
      resources: ['*'],
    }))

    new CfnOutput(this, 'Url', { value: `https://${domainName}` })
    new CfnOutput(this, 'LoadBalancerDnsName', {
      value: web.loadBalancer.loadBalancerDnsName,
      description: zone ? 'Route 53 points the domain here' : `Add a CNAME record from ${domainName} to this name`,
    })
    new CfnOutput(this, 'AppSecretName', { value: appSecret.secretName })
    new CfnOutput(this, 'ClusterName', { value: cluster.clusterName })
    new CfnOutput(this, 'ServiceName', { value: web.service.serviceName })
    new CfnOutput(this, 'DbToolTaskFamily', { value: tool.family })
    new CfnOutput(this, 'DbToolSecurityGroupId', { value: toolSecurityGroup.securityGroupId })
    new CfnOutput(this, 'PublicSubnets', { value: vpc.publicSubnets.map(subnet => subnet.subnetId).join(',') })
  }
}
