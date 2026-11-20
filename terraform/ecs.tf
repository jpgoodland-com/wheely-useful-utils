resource "aws_ecs_cluster" "main" {
  name = var.app_name

  setting {
    name  = "containerInsights"
    value = "disabled"
  }

  tags = { Name = var.app_name }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 100
    base              = 0
  }
}

resource "aws_cloudwatch_log_group" "app" {
  name = "/ecs/${var.app_name}"
  # One year: SOC 2 / ISO 27001 auditors expect a year of security logs.
  retention_in_days = 365
}

resource "aws_ecs_task_definition" "app" {
  family                   = var.app_name
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.task_exec.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name      = var.app_name
    image     = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"
    essential = true

    portMappings = [{
      containerPort = 3000
      protocol      = "tcp"
    }]

    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "AWS_REGION", value = var.aws_region },
      { name = "FORCE_HTTPS", value = "true" },
      { name = "APP_DOMAIN", value = var.domain },
      { name = "SES_CONFIG_SET", value = aws_ses_configuration_set.app.name },
      { name = "OAUTH_GOOGLE_CLIENT_ID", value = var.oauth_google_client_id },
      { name = "OAUTH_MICROSOFT_CLIENT_ID", value = var.oauth_microsoft_client_id },
      { name = "OAUTH_GITHUB_CLIENT_ID", value = var.oauth_github_client_id },
      { name = "ADMIN_EMAILS", value = var.admin_emails },
      { name = "DONATION_URL", value = var.donation_url },
      { name = "APP_KMS_KEY_ID", value = aws_kms_key.app.arn },
    ]

    # Secrets are injected from Secrets Manager — never appear in plaintext
    secrets = [
      {
        name      = "OAUTH_GOOGLE_CLIENT_SECRET"
        valueFrom = aws_secretsmanager_secret.oauth_google.arn
      },
      {
        name      = "OAUTH_MICROSOFT_CLIENT_SECRET"
        valueFrom = aws_secretsmanager_secret.oauth_microsoft.arn
      },
      {
        name      = "OAUTH_GITHUB_CLIENT_SECRET"
        valueFrom = aws_secretsmanager_secret.oauth_github.arn
      },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.app.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

resource "aws_ecs_service" "app" {
  name            = var.app_name
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.desired_count

  # give a new task time to start Node before ALB health checks count.
  health_check_grace_period_seconds = 60

  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 100
    base              = 0
  }

  # Pick up new task definitions automatically on the next deployment
  force_new_deployment = true

  # Roll back a deployment whose tasks never become healthy, instead of
  # retrying forever (monitoring.tf emails when this happens).
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # Both subnets are in different AZs, and ECS spreads Fargate tasks across
  # them, so with desired_count = 2 one AZ or task loss leaves a healthy target.
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = var.app_name
    container_port   = 3000
  }

  depends_on = [
    aws_lb_listener.https,
    aws_iam_role_policy_attachment.task_exec_managed,
  ]
}
