import { CfnOutput, Duration, Fn, RemovalPolicy } from 'aws-cdk-lib'
import { aws_route53 as route53, aws_ssm as ssm } from 'aws-cdk-lib'
import { Construct } from 'constructs'

/** Vercel's address for a zone apex (https://vercel.com/docs/domains): the site until the cutover. */
const VERCEL_APEX = '76.76.21.21'

/**
 * The hosted zone of the site's name, which Cloudflare delegates to Route 53 with NS records (the domain is registered at
 * Cloudflare Registrar, so its own name servers cannot move). The apex record is one resource, ApexRecord, whether it
 * points at Vercel or at the load balancer, so the cutover is an in-place change of that record and the name never
 * goes missing. The load balancer lives in the other stack (Typle), which names it in SSM parameters; reading them at
 * deploy time keeps the two stacks free of a cycle.
 */
export const LOAD_BALANCER_PARAMETERS = { dnsName: '/typle/load-balancer/dns-name', hostedZoneId: '/typle/load-balancer/hosted-zone-id' }

export class Dns extends Construct {
  readonly zone: route53.PublicHostedZone
  private readonly apex: route53.CfnRecordSet

  constructor(scope: Construct, id: string, props: { domain: string }) {
    super(scope, id)
    this.zone = new route53.PublicHostedZone(this, 'Zone', { zoneName: props.domain })
    // Deleting the zone while Cloudflare still delegates to its name servers would let another account claim the name.
    this.zone.applyRemovalPolicy(RemovalPolicy.RETAIN)
    this.apex = new route53.CfnRecordSet(this, 'Apex', {
      hostedZoneId: this.zone.hostedZoneId,
      name: `${props.domain}.`,
      type: 'A',
      ttl: Duration.seconds(60).toSeconds().toString(),
      resourceRecords: [VERCEL_APEX],
    })
    this.apex.overrideLogicalId('ApexRecord')
    new CfnOutput(this, 'NameServers', {
      key: 'NameServers',
      description: 'The NS records to add for this name in Cloudflare',
      value: Fn.join(',', this.zone.hostedZoneNameServers ?? []),
    })
  }

  /** Points the apex at the load balancer instead of Vercel (dnsTarget=aws: the cutover). */
  aliasToLoadBalancer(): void {
    this.apex.ttl = undefined
    this.apex.resourceRecords = undefined
    this.apex.aliasTarget = {
      dnsName: ssm.StringParameter.valueForStringParameter(this, LOAD_BALANCER_PARAMETERS.dnsName),
      hostedZoneId: ssm.StringParameter.valueForStringParameter(this, LOAD_BALANCER_PARAMETERS.hostedZoneId),
    }
  }
}
