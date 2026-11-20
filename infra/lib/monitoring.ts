import { Duration } from 'aws-cdk-lib'
import {
  aws_cloudwatch as cloudwatch, aws_cloudwatch_actions as actions, aws_elasticloadbalancingv2 as elbv2,
  aws_rds as rds, aws_sns as sns, aws_sns_subscriptions as subscriptions,
} from 'aws-cdk-lib'
import { Construct } from 'constructs'

/** Five alarms mailed through one SNS topic, as in docs/aws/08-monitoring.md. */
export class Monitoring extends Construct {
  constructor(scope: Construct, id: string, props: {
    alarmEmail?: string, loadBalancer: elbv2.ApplicationLoadBalancer, targetGroup: elbv2.ApplicationTargetGroup,
    database: rds.DatabaseInstance,
  }) {
    super(scope, id)
    const topic = new sns.Topic(this, 'Alarms', { topicName: 'typle-alarms' })
    if (props.alarmEmail) topic.addSubscription(new subscriptions.EmailSubscription(props.alarmEmail))
    const action = new actions.SnsAction(topic)
    const period = Duration.minutes(5)
    const alarm = (key: string, metric: cloudwatch.IMetric, threshold: number,
      comparisonOperator: cloudwatch.ComparisonOperator, missing = cloudwatch.TreatMissingData.MISSING) => {
      const created = new cloudwatch.Alarm(this, key, {
        alarmName: `typle-${key}`, metric, threshold, comparisonOperator, evaluationPeriods: 1, treatMissingData: missing,
      })
      created.addAlarmAction(action)
      created.addOkAction(action)
    }
    const atLeast = cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
    const notBreaching = cloudwatch.TreatMissingData.NOT_BREACHING
    const lb = props.loadBalancer.metrics
    alarm('5xx', lb.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, { period, statistic: 'Sum' }), 5, atLeast, notBreaching)
    alarm('elb-5xx', lb.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, { period, statistic: 'Sum' }), 5, atLeast, notBreaching)
    alarm('unhealthy', props.targetGroup.metrics.unhealthyHostCount({ period, statistic: 'Maximum' }), 1, atLeast)
    alarm('db-cpu', props.database.metricCPUUtilization({ period, statistic: 'Average' }), 80, atLeast)
    alarm('db-storage', props.database.metricFreeStorageSpace({ period, statistic: 'Minimum' }), 2 * 1024 ** 3,
      cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD)
  }
}
