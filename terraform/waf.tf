# ── AWS WAF on the load balancer (security plan H2/M10) ──────────────────────
# Managed rule groups for common web attacks, known bad inputs and IP
# reputation, plus per-IP rate rules. Rate limits here see the real client
# address and hold across both tasks, in front of the app's own limits.

resource "aws_wafv2_web_acl" "app" {
  name  = "${var.app_name}-web-acl"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "aws-common"
    priority = 10
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
        # Coin images are uploaded as data URLs in JSON bodies over 8 KB;
        # the app enforces its own body limits (readJsonLimited).
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.app_name}-aws-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 20
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.app_name}-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-ip-reputation"
    priority = 30
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.app_name}-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-auth"
    priority = 40
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.waf_auth_requests_per_5min
        aggregate_key_type = "IP"
        scope_down_statement {
          byte_match_statement {
            search_string         = "/api/auth/"
            positional_constraint = "STARTS_WITH"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.app_name}-rate-auth"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-all"
    priority = 50
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.waf_requests_per_5min
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.app_name}-rate-all"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.app_name}-web-acl"
    sampled_requests_enabled   = true
  }

  tags = { Name = "${var.app_name}-web-acl" }
}

resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = aws_lb.app.arn
  web_acl_arn  = aws_wafv2_web_acl.app.arn
}

# Blocked requests only (allowed traffic is already in the ALB access logs),
# kept a year. WAF requires the "aws-waf-logs-" name prefix.
resource "aws_cloudwatch_log_group" "waf" {
  name              = "aws-waf-logs-${var.app_name}"
  retention_in_days = 365
}

resource "aws_wafv2_web_acl_logging_configuration" "app" {
  resource_arn            = aws_wafv2_web_acl.app.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]

  logging_filter {
    default_behavior = "DROP"
    filter {
      behavior    = "KEEP"
      requirement = "MEETS_ANY"
      condition {
        action_condition {
          action = "BLOCK"
        }
      }
    }
  }
}
