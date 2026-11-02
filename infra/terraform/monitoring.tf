resource "aws_sns_topic" "alarms" {
  name              = "${local.name}-alarms"
  kms_master_key_id = aws_kms_key.data.id
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  alarms = {
    api_5xx = {
      namespace   = "AWS/ApplicationELB", metric = "HTTPCode_Target_5XX_Count", stat = "Sum", threshold = 25, period = 300,
      dimensions  = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = aws_lb_target_group.api.arn_suffix },
      description = "The API answered more than 25 server errors in 5 minutes"
    }
    api_unhealthy = {
      namespace   = "AWS/ApplicationELB", metric = "UnHealthyHostCount", stat = "Maximum", threshold = 0, period = 60,
      dimensions  = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = aws_lb_target_group.api.arn_suffix },
      description = "An API task is failing its health check"
    }
    db_cpu = {
      namespace   = "AWS/RDS", metric = "CPUUtilization", stat = "Average", threshold = 80, period = 300,
      dimensions  = { DBInstanceIdentifier = aws_db_instance.main.identifier },
      description = "Database CPU above 80% for 5 minutes"
    }
    db_storage = {
      namespace   = "AWS/RDS", metric = "FreeStorageSpace", stat = "Minimum", threshold = 5 * 1024 * 1024 * 1024, period = 300,
      dimensions  = { DBInstanceIdentifier = aws_db_instance.main.identifier }, comparison = "LessThanThreshold",
      description = "Less than 5 GB of database storage left"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "main" {
  for_each            = local.alarms
  alarm_name          = "${local.name}-${each.key}"
  alarm_description   = each.value.description
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = each.value.stat
  period              = each.value.period
  evaluation_periods  = 1
  threshold           = each.value.threshold
  comparison_operator = lookup(each.value, "comparison", "GreaterThanThreshold")
  dimensions          = each.value.dimensions
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}
