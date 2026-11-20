import { aws_ec2 as ec2 } from 'aws-cdk-lib'
import { Construct } from 'constructs'

/**
 * Two availability zones, each with a public subnet (the load balancer and the app's tasks) and a private one (the
 * database). No NAT gateway: the tasks have public addresses and reach the internet (GitHub, Resend, ECR, Secrets
 * Manager) through the internet gateway, and the security groups let in only the load balancer.
 */
export class Network extends Construct {
  readonly vpc: ec2.Vpc
  readonly loadBalancerGroup: ec2.SecurityGroup
  readonly taskGroup: ec2.SecurityGroup
  readonly databaseGroup: ec2.SecurityGroup

  constructor(scope: Construct, id: string) {
    super(scope, id)
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    })
    // The listeners open 80 and 443 to the internet (lib/app.ts).
    this.loadBalancerGroup = new ec2.SecurityGroup(this, 'LoadBalancer', { vpc: this.vpc, description: 'The load balancer' })
    this.taskGroup = new ec2.SecurityGroup(this, 'Tasks', { vpc: this.vpc, description: 'The tasks: the app and the one-off tasks' })
    this.taskGroup.addIngressRule(this.loadBalancerGroup, ec2.Port.tcp(3000), 'The app, from the load balancer')
    this.databaseGroup = new ec2.SecurityGroup(this, 'Database', { vpc: this.vpc, description: 'The database', allowAllOutbound: false })
    this.databaseGroup.addIngressRule(this.taskGroup, ec2.Port.tcp(5432), 'PostgreSQL, from the tasks')
  }
}
