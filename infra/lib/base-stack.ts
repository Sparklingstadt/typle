import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib'
import { aws_ecr as ecr } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import type { Config } from './config.ts'
import { Dns } from './dns.ts'

/**
 * What lives before and beyond the app: the hosted zone Cloudflare delegates to, the apex record, and the image
 * repository (so that the first image is pushed before the service exists). Deployed first, then only at the cutover;
 * releases deploy the Typle stack alone (scripts/deploy-aws.cjs).
 */
export class TypleBaseStack extends Stack {
  readonly dns: Dns
  readonly repository: ecr.Repository

  constructor(scope: Construct, id: string, props: StackProps & { config: Config }) {
    super(scope, id, { ...props, terminationProtection: true })
    this.dns = new Dns(this, 'Dns', { domain: props.config.domain })
    if (props.config.dnsTarget === 'aws') this.dns.aliasToLoadBalancer()
    this.repository = new ecr.Repository(this, 'Repository', {
      repositoryName: 'typle',
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      imageScanOnPush: true,
      lifecycleRules: [{ description: 'Keep the last 10 images', maxImageCount: 10 }],
      removalPolicy: RemovalPolicy.RETAIN,
    })
    new CfnOutput(this, 'RepositoryUri', { key: 'RepositoryUri', value: this.repository.repositoryUri })
  }
}
