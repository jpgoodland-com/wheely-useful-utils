# ── Monitoring & alerting ─────────────────────────────────────────────────────
# CloudWatch alarms notify the SNS topic below, which emails var.alarm_email.
# Groups: availability, latency & scaling, security & abuse, email reputation,
# database. One dashboard (`<app_name>-operations`) shows the same signals.
#
# Cost (approx.): ~$0.10/month per alarm metric (metric-math alarms count each
# metric they read), $0.30/month per custom metric from
# the log metric filters, and dashboards are free up to 3 per account. Alarms
# use static thresholds rather than anomaly detection (3x the price, and noisy
# at low traffic); tune them in `locals.alarm` below.

locals {
  alb_dimensions = { LoadBalancer = aws_lb.app.arn_suffix }
  tg_dimensions  = { LoadBalancer = aws_lb.app.arn_suffix, TargetGroup = aws_lb_target_group.app.arn_suffix }
  ecs_dimensions = { ClusterName = aws_ecs_cluster.main.name, ServiceName = aws_ecs_service.app.name }
  alarm_actions  = [aws_sns_topic.alerts.arn]

  # Metric namespace for counts derived from the app's structured logs.
  app_metric_namespace = "WheelApp"

  dynamodb_tables = {
    users          = aws_dynamodb_table.users.name
    wheels         = aws_dynamodb_table.wheels.name
    coinflip       = aws_dynamodb_table.coinflip.name
    capacity_plans = aws_dynamodb_table.capacity_plans.name
  }

  alarm = {
    latency_p95_seconds       = var.alarm_latency_p95_seconds
    requests_per_5min         = var.alarm_requests_per_5min
    target_5xx_percent        = 5
    min_requests_for_5xx_rate = 20
    elb_5xx_per_5min          = 10
    client_4xx_per_5min       = 500
    cpu_percent               = 80
    memory_percent            = 85
    rate_limited_per_5min     = 10
    login_failures_per_5min   = 25
    app_errors_per_5min       = 10
    ses_sends_per_hour        = var.alarm_ses_sends_per_hour
    ses_bounce_rate           = 0.05  # SES puts accounts under review at 10%
    ses_complaint_rate        = 0.001 # SES puts accounts under review at 0.5%
    dynamodb_throttles        = 10
  }
}

# ── Notifications ─────────────────────────────────────────────────────────────

# Not KMS-encrypted: CloudWatch can't publish to topics using the AWS-managed
# SNS key, and alarm messages contain no user data.
resource "aws_sns_topic" "alerts" {
  name = "${var.app_name}-alerts"

  tags = { Name = "${var.app_name}-alerts" }
}

# AWS emails a confirmation link to this address; alerts arrive once it's confirmed.
resource "aws_sns_topic_subscription" "alerts_email" {
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# Lets CloudWatch alarms and EventBridge rules in this account publish.
resource "aws_sns_topic_policy" "alerts" {
  arn = aws_sns_topic.alerts.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowAlarmAndEventPublish"
      Effect    = "Allow"
      Principal = { Service = ["cloudwatch.amazonaws.com", "events.amazonaws.com"] }
      Action    = "sns:Publish"
      Resource  = aws_sns_topic.alerts.arn
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}

# ── Availability ──────────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "no_healthy_targets" {
  alarm_name          = "${var.app_name}-no-healthy-targets"
  alarm_description   = "No healthy app tasks behind the load balancer: the site is down. Check ECS service events and task logs."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  dimensions          = local.tg_dimensions
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "unhealthy_targets" {
  alarm_name          = "${var.app_name}-unhealthy-targets"
  alarm_description   = "A task has failed load balancer health checks for 5 minutes."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  dimensions          = local.tg_dimensions
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "elb_5xx" {
  alarm_name          = "${var.app_name}-load-balancer-5xx"
  alarm_description   = "The load balancer itself is returning 5xx errors (502/503/504), usually because no task can serve requests."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_ELB_5XX_Count"
  dimensions          = local.alb_dimensions
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = local.alarm.elb_5xx_per_5min
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "target_5xx_rate" {
  alarm_name          = "${var.app_name}-app-5xx-rate"
  alarm_description   = "More than ${local.alarm.target_5xx_percent}% of requests are failing with app 5xx errors (only counted above ${local.alarm.min_requests_for_5xx_rate} requests per 5 minutes)."
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = local.alarm.target_5xx_percent
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  metric_query {
    id          = "rate"
    expression  = "IF(requests >= ${local.alarm.min_requests_for_5xx_rate}, 100 * errors / requests, 0)"
    label       = "App 5xx %"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      dimensions  = local.alb_dimensions
      stat        = "Sum"
      period      = 300
    }
  }

  metric_query {
    id = "requests"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "RequestCount"
      dimensions  = local.alb_dimensions
      stat        = "Sum"
      period      = 300
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "app_errors" {
  alarm_name          = "${var.app_name}-app-errors"
  alarm_description   = "The app is logging errors at an unusual rate. See the 'Recent errors' widget on the dashboard."
  namespace           = local.app_metric_namespace
  metric_name         = aws_cloudwatch_log_metric_filter.app_errors.metric_transformation[0].name
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = local.alarm.app_errors_per_5min
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# ── Latency, traffic & scaling ────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "latency_p95" {
  alarm_name          = "${var.app_name}-latency-p95"
  alarm_description   = "95th percentile response time has been above ${local.alarm.latency_p95_seconds}s for 10 minutes. Consider more CPU/memory or tasks."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  dimensions          = local.alb_dimensions
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 2
  comparison_operator = "GreaterThanThreshold"
  threshold           = local.alarm.latency_p95_seconds
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "request_spike" {
  alarm_name          = "${var.app_name}-request-spike"
  alarm_description   = "More than ${local.alarm.requests_per_5min} requests in 5 minutes. Could be a traffic surge (consider scaling) or a flood; compare with the rate-limited clients alarm."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "RequestCount"
  dimensions          = local.alb_dimensions
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = local.alarm.requests_per_5min
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "ecs_cpu_high" {
  alarm_name          = "${var.app_name}-cpu-high"
  alarm_description   = "Average task CPU above ${local.alarm.cpu_percent}% for 10 minutes. Consider raising task_cpu or desired_count."
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  dimensions          = local.ecs_dimensions
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  comparison_operator = "GreaterThanThreshold"
  threshold           = local.alarm.cpu_percent
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "ecs_memory_high" {
  alarm_name          = "${var.app_name}-memory-high"
  alarm_description   = "Average task memory above ${local.alarm.memory_percent}% for 10 minutes. Tasks are killed when they run out; consider raising task_memory."
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  dimensions          = local.ecs_dimensions
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  comparison_operator = "GreaterThanThreshold"
  threshold           = local.alarm.memory_percent
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# ── Security & abuse ──────────────────────────────────────────────────────────
# The app logs one JSON line per security event (lib/securityLog.js). These
# filters count them; the metrics have no dimensions to keep it to one custom
# metric each. Use the dashboard's log widget to see tiers and client IPs.

resource "aws_cloudwatch_log_metric_filter" "rate_limited" {
  name           = "${var.app_name}-rate-limited"
  log_group_name = aws_cloudwatch_log_group.app.name
  pattern        = "{ $.securityEvent = \"rate_limited\" }"

  metric_transformation {
    name          = "RateLimitedClients"
    namespace     = local.app_metric_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_log_metric_filter" "login_failed" {
  name           = "${var.app_name}-login-failed"
  log_group_name = aws_cloudwatch_log_group.app.name
  pattern        = "{ $.securityEvent = \"login_failed\" }"

  metric_transformation {
    name          = "LoginFailures"
    namespace     = local.app_metric_namespace
    value         = "1"
    default_value = "0"
  }
}

# Route handlers log unexpected failures with console.error ("... error", Error objects).
resource "aws_cloudwatch_log_metric_filter" "app_errors" {
  name           = "${var.app_name}-app-errors"
  log_group_name = aws_cloudwatch_log_group.app.name
  pattern        = "?error ?Error ?ERROR"

  metric_transformation {
    name          = "AppErrors"
    namespace     = local.app_metric_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "rate_limited_clients" {
  alarm_name          = "${var.app_name}-rate-limited-clients"
  alarm_description   = "Many clients are hitting rate limits: possible DDoS, scraping or a misbehaving integration. Check the security events widget for IPs and tiers."
  namespace           = local.app_metric_namespace
  metric_name         = aws_cloudwatch_log_metric_filter.rate_limited.metric_transformation[0].name
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = local.alarm.rate_limited_per_5min
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "login_failures" {
  alarm_name          = "${var.app_name}-login-failures"
  alarm_description   = "Unusually many failed logins: possible credential stuffing or brute force."
  namespace           = local.app_metric_namespace
  metric_name         = aws_cloudwatch_log_metric_filter.login_failed.metric_transformation[0].name
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = local.alarm.login_failures_per_5min
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "client_4xx_spike" {
  alarm_name          = "${var.app_name}-client-4xx-spike"
  alarm_description   = "Many 4xx responses (not found, unauthorized, rate limited): possible vulnerability scanning or probing."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_4XX_Count"
  dimensions          = local.alb_dimensions
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = local.alarm.client_4xx_per_5min
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# ── Email (signup / password-reset spam and sender reputation) ────────────────
# SES metrics are account-wide for the region.

resource "aws_cloudwatch_metric_alarm" "ses_send_spike" {
  alarm_name          = "${var.app_name}-email-send-spike"
  alarm_description   = "More than ${local.alarm.ses_sends_per_hour} emails sent in an hour: possible signup, invite or password-reset spam."
  namespace           = "AWS/SES"
  metric_name         = "Send"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = local.alarm.ses_sends_per_hour
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "ses_bounce_rate" {
  alarm_name          = "${var.app_name}-email-bounce-rate"
  alarm_description   = "SES bounce rate is at or above ${local.alarm.ses_bounce_rate * 100}%. Fake signups are the usual cause; AWS may pause sending if it keeps rising."
  namespace           = "AWS/SES"
  metric_name         = "Reputation.BounceRate"
  statistic           = "Maximum"
  period              = 900
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = local.alarm.ses_bounce_rate
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "ses_complaint_rate" {
  alarm_name          = "${var.app_name}-email-complaint-rate"
  alarm_description   = "SES complaint (marked-as-spam) rate is at or above ${local.alarm.ses_complaint_rate * 100}%. AWS may pause sending if it keeps rising."
  namespace           = "AWS/SES"
  metric_name         = "Reputation.ComplaintRate"
  statistic           = "Maximum"
  period              = 900
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = local.alarm.ses_complaint_rate
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# ── Database ──────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "dynamodb_throttles" {
  alarm_name          = "${var.app_name}-dynamodb-throttles"
  alarm_description   = "DynamoDB is throttling requests across the app's tables. On-demand tables rarely throttle, so this usually means a sudden burst or hot key."
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = local.alarm.dynamodb_throttles
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  metric_query {
    id          = "total"
    expression  = "SUM([${join(", ", flatten([for k in keys(local.dynamodb_tables) : ["r_${k}", "w_${k}"]]))}])"
    label       = "Throttled events (all tables)"
    return_data = true
  }

  dynamic "metric_query" {
    for_each = local.dynamodb_tables
    content {
      id = "r_${metric_query.key}"
      metric {
        namespace   = "AWS/DynamoDB"
        metric_name = "ReadThrottleEvents"
        dimensions  = { TableName = metric_query.value }
        stat        = "Sum"
        period      = 300
      }
    }
  }

  dynamic "metric_query" {
    for_each = local.dynamodb_tables
    content {
      id = "w_${metric_query.key}"
      metric {
        namespace   = "AWS/DynamoDB"
        metric_name = "WriteThrottleEvents"
        dimensions  = { TableName = metric_query.value }
        stat        = "Sum"
        period      = 300
      }
    }
  }
}

# ── ECS events ────────────────────────────────────────────────────────────────
# Fargate Spot interruptions, crashed containers and failed deployments, sent
# as they happen. Tasks stopped by normal deployments and scaling are ignored.

resource "aws_cloudwatch_event_rule" "ecs_task_stopped" {
  name        = "${var.app_name}-task-stopped"
  description = "App task stopped unexpectedly (Spot interruption, crash or failed start)"

  event_pattern = jsonencode({
    source      = ["aws.ecs"]
    detail-type = ["ECS Task State Change"]
    detail = {
      clusterArn = [aws_ecs_cluster.main.arn]
      lastStatus = ["STOPPED"]
      stopCode   = ["SpotInterruption", "EssentialContainerExited", "TaskFailedToStart"]
    }
  })
}

resource "aws_cloudwatch_event_target" "ecs_task_stopped" {
  rule = aws_cloudwatch_event_rule.ecs_task_stopped.name
  arn  = aws_sns_topic.alerts.arn

  input_transformer {
    input_paths = {
      stopCode = "$.detail.stopCode"
      reason   = "$.detail.stoppedReason"
      task     = "$.detail.taskArn"
      time     = "$.time"
    }
    input_template = "\"${var.app_name}: a task stopped unexpectedly at <time> (<stopCode>): <reason>. ECS starts a replacement automatically; the no-healthy-targets alarm fires if it can't. Task: <task>\""
  }
}

# Every stopped task, including deployments and scale-ins, written to CloudWatch
# Logs. ECS keeps stopped tasks for only about an hour, so this is where to look
# up stoppedReason afterwards.
resource "aws_cloudwatch_log_group" "ecs_events" {
  name              = "/aws/events/${var.app_name}-ecs"
  retention_in_days = 30
}

resource "aws_cloudwatch_event_rule" "ecs_task_stopped_log" {
  name        = "${var.app_name}-task-stopped-log"
  description = "Log every stopped app task with its stop code and reason"

  event_pattern = jsonencode({
    source      = ["aws.ecs"]
    detail-type = ["ECS Task State Change"]
    detail = {
      clusterArn = [aws_ecs_cluster.main.arn]
      lastStatus = ["STOPPED"]
    }
  })
}

resource "aws_cloudwatch_event_target" "ecs_task_stopped_log" {
  rule = aws_cloudwatch_event_rule.ecs_task_stopped_log.name
  arn  = aws_cloudwatch_log_group.ecs_events.arn
}

# EventBridge writes to CloudWatch Logs through the log group's resource
# policy, not an IAM role.
resource "aws_cloudwatch_log_resource_policy" "ecs_events" {
  policy_name = "${var.app_name}-ecs-events"

  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowEventBridgeToWriteEcsEvents"
      Effect    = "Allow"
      Principal = { Service = ["events.amazonaws.com", "delivery.logs.amazonaws.com"] }
      Action    = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource  = "${aws_cloudwatch_log_group.ecs_events.arn}:*"
    }]
  })
}

resource "aws_cloudwatch_event_rule" "ecs_deployment_failed" {
  name        = "${var.app_name}-deployment-failed"
  description = "App deployment failed and was rolled back"

  event_pattern = jsonencode({
    source      = ["aws.ecs"]
    detail-type = ["ECS Deployment State Change"]
    resources   = [aws_ecs_service.app.id]
    detail      = { eventName = ["SERVICE_DEPLOYMENT_FAILED"] }
  })
}

resource "aws_cloudwatch_event_target" "ecs_deployment_failed" {
  rule = aws_cloudwatch_event_rule.ecs_deployment_failed.name
  arn  = aws_sns_topic.alerts.arn

  input_transformer {
    input_paths = {
      reason = "$.detail.reason"
      time   = "$.time"
    }
    input_template = "\"${var.app_name}: a deployment failed at <time> and was rolled back to the previous version: <reason>\""
  }
}

# ── Dashboard ─────────────────────────────────────────────────────────────────

locals {
  dashboard_region = var.aws_region
  alb_metric       = ["LoadBalancer", aws_lb.app.arn_suffix]
  tg_metric        = ["TargetGroup", aws_lb_target_group.app.arn_suffix, "LoadBalancer", aws_lb.app.arn_suffix]
  ecs_metric       = ["ClusterName", aws_ecs_cluster.main.name, "ServiceName", aws_ecs_service.app.name]

  dashboard_widgets = [
    {
      type = "text", x = 0, y = 0, width = 24, height = 2
      properties = {
        markdown = "## ${var.app_name} operations\nAlarms email the `${aws_sns_topic.alerts.name}` SNS topic. Thresholds live in `terraform/monitoring.tf` (`locals.alarm`)."
      }
    },
    {
      type = "alarm", x = 0, y = 2, width = 24, height = 4
      properties = {
        title = "Alarm status"
        alarms = [
          aws_cloudwatch_metric_alarm.no_healthy_targets.arn,
          aws_cloudwatch_metric_alarm.unhealthy_targets.arn,
          aws_cloudwatch_metric_alarm.elb_5xx.arn,
          aws_cloudwatch_metric_alarm.target_5xx_rate.arn,
          aws_cloudwatch_metric_alarm.app_errors.arn,
          aws_cloudwatch_metric_alarm.latency_p95.arn,
          aws_cloudwatch_metric_alarm.request_spike.arn,
          aws_cloudwatch_metric_alarm.ecs_cpu_high.arn,
          aws_cloudwatch_metric_alarm.ecs_memory_high.arn,
          aws_cloudwatch_metric_alarm.rate_limited_clients.arn,
          aws_cloudwatch_metric_alarm.login_failures.arn,
          aws_cloudwatch_metric_alarm.client_4xx_spike.arn,
          aws_cloudwatch_metric_alarm.ses_send_spike.arn,
          aws_cloudwatch_metric_alarm.ses_bounce_rate.arn,
          aws_cloudwatch_metric_alarm.ses_complaint_rate.arn,
          aws_cloudwatch_metric_alarm.dynamodb_throttles.arn,
        ]
      }
    },
    {
      type = "metric", x = 0, y = 6, width = 12, height = 6
      properties = {
        title  = "Requests and responses"
        region = local.dashboard_region
        stat   = "Sum"
        period = 300
        view   = "timeSeries"
        metrics = [
          concat(["AWS/ApplicationELB", "RequestCount"], local.alb_metric, [{ label = "Requests" }]),
          concat(["AWS/ApplicationELB", "HTTPCode_Target_2XX_Count"], local.alb_metric, [{ label = "2xx" }]),
          concat(["AWS/ApplicationELB", "HTTPCode_Target_4XX_Count"], local.alb_metric, [{ label = "4xx" }]),
          concat(["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count"], local.alb_metric, [{ label = "App 5xx" }]),
          concat(["AWS/ApplicationELB", "HTTPCode_ELB_5XX_Count"], local.alb_metric, [{ label = "Load balancer 5xx" }]),
        ]
      }
    },
    {
      type = "metric", x = 12, y = 6, width = 12, height = 6
      properties = {
        title  = "Response time (seconds)"
        region = local.dashboard_region
        period = 300
        view   = "timeSeries"
        metrics = [
          concat(["AWS/ApplicationELB", "TargetResponseTime"], local.alb_metric, [{ stat = "p50", label = "p50" }]),
          concat(["AWS/ApplicationELB", "TargetResponseTime"], local.alb_metric, [{ stat = "p95", label = "p95" }]),
          concat(["AWS/ApplicationELB", "TargetResponseTime"], local.alb_metric, [{ stat = "p99", label = "p99" }]),
        ]
        annotations = { horizontal = [{ label = "p95 alarm", value = local.alarm.latency_p95_seconds }] }
      }
    },
    {
      type = "metric", x = 0, y = 12, width = 8, height = 6
      properties = {
        title  = "Healthy tasks"
        region = local.dashboard_region
        stat   = "Minimum"
        period = 60
        view   = "timeSeries"
        metrics = [
          concat(["AWS/ApplicationELB", "HealthyHostCount"], local.tg_metric, [{ label = "Healthy" }]),
          concat(["AWS/ApplicationELB", "UnHealthyHostCount"], local.tg_metric, [{ stat = "Maximum", label = "Unhealthy" }]),
        ]
        yAxis = { left = { min = 0 } }
      }
    },
    {
      type = "metric", x = 8, y = 12, width = 8, height = 6
      properties = {
        title  = "Task CPU and memory (%)"
        region = local.dashboard_region
        stat   = "Average"
        period = 300
        view   = "timeSeries"
        metrics = [
          concat(["AWS/ECS", "CPUUtilization"], local.ecs_metric, [{ label = "CPU" }]),
          concat(["AWS/ECS", "MemoryUtilization"], local.ecs_metric, [{ label = "Memory" }]),
        ]
        yAxis = { left = { min = 0, max = 100 } }
      }
    },
    {
      type = "metric", x = 16, y = 12, width = 8, height = 6
      properties = {
        title  = "Security events"
        region = local.dashboard_region
        stat   = "Sum"
        period = 300
        view   = "timeSeries"
        metrics = [
          [local.app_metric_namespace, "RateLimitedClients", { label = "Rate-limited clients" }],
          [local.app_metric_namespace, "LoginFailures", { label = "Failed logins" }],
          [local.app_metric_namespace, "AppErrors", { label = "App errors" }],
        ]
      }
    },
    {
      type = "metric", x = 0, y = 18, width = 12, height = 6
      properties = {
        title  = "Email (SES)"
        region = local.dashboard_region
        period = 3600
        view   = "timeSeries"
        metrics = [
          ["AWS/SES", "Send", { stat = "Sum", label = "Sent per hour" }],
          ["AWS/SES", "Reputation.BounceRate", { stat = "Maximum", label = "Bounce rate", yAxis = "right" }],
          ["AWS/SES", "Reputation.ComplaintRate", { stat = "Maximum", label = "Complaint rate", yAxis = "right" }],
        ]
      }
    },
    {
      type = "metric", x = 12, y = 18, width = 12, height = 6
      properties = {
        title  = "DynamoDB capacity used and throttles"
        region = local.dashboard_region
        stat   = "Sum"
        period = 300
        view   = "timeSeries"
        metrics = concat(
          [for k, t in local.dynamodb_tables : ["AWS/DynamoDB", "ConsumedReadCapacityUnits", "TableName", t, { label = "${t} reads" }]],
          [for k, t in local.dynamodb_tables : ["AWS/DynamoDB", "ConsumedWriteCapacityUnits", "TableName", t, { label = "${t} writes" }]],
          [for k, t in local.dynamodb_tables : ["AWS/DynamoDB", "ReadThrottleEvents", "TableName", t, { label = "${t} read throttles", yAxis = "right" }]],
          [for k, t in local.dynamodb_tables : ["AWS/DynamoDB", "WriteThrottleEvents", "TableName", t, { label = "${t} write throttles", yAxis = "right" }]],
        )
      }
    },
    {
      type = "log", x = 0, y = 24, width = 12, height = 6
      properties = {
        title  = "Security events by client (top 20)"
        region = local.dashboard_region
        view   = "table"
        query  = "SOURCE '${aws_cloudwatch_log_group.app.name}' | filter ispresent(securityEvent) | stats count(*) as events by securityEvent, tier, ip | sort events desc | limit 20"
      }
    },
    {
      type = "log", x = 12, y = 24, width = 12, height = 6
      properties = {
        title  = "Recent errors"
        region = local.dashboard_region
        view   = "table"
        query  = "SOURCE '${aws_cloudwatch_log_group.app.name}' | fields @timestamp, @message | filter @message like /(?i)error/ and not ispresent(securityEvent) | sort @timestamp desc | limit 50"
      }
    },
  ]
}

resource "aws_cloudwatch_dashboard" "operations" {
  dashboard_name = "${var.app_name}-operations"
  dashboard_body = jsonencode({ widgets = local.dashboard_widgets })
}
