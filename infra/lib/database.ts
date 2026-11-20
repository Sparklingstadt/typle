import { Duration, RemovalPolicy } from 'aws-cdk-lib'
import { aws_ec2 as ec2, aws_rds as rds } from 'aws-cdk-lib'
import { Construct } from 'constructs'

/**
 * PostgreSQL 17 (as compose.yaml) on the smallest Graviton instance, in the private subnets, single-AZ (cost; the
 * runbook explains Multi-AZ). The master password is generated into Secrets Manager; the app connects as its own user,
 * typle_app, which the dbuser task creates (docs/aws/production.md).
 */
export class Database extends Construct {
  readonly instance: rds.DatabaseInstance

  constructor(scope: Construct, id: string, props: { vpc: ec2.IVpc, securityGroup: ec2.ISecurityGroup }) {
    super(scope, id)
    this.instance = new rds.DatabaseInstance(this, 'Instance', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_17 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [props.securityGroup],
      credentials: rds.Credentials.fromGeneratedSecret('postgres'),
      databaseName: 'typle',
      allocatedStorage: 20,
      storageType: rds.StorageType.GP3,
      multiAz: false,
      storageEncrypted: true,
      publiclyAccessible: false,
      backupRetention: Duration.days(7),
      deletionProtection: true,
      // Deleting the stack leaves a final snapshot instead of nothing.
      removalPolicy: RemovalPolicy.SNAPSHOT,
    })
  }
}
