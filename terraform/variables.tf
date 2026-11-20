variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-west-2"
}

variable "app_name" {
  description = "Short name used to prefix all resources"
  type        = string
  default     = "wheel-app"
}

variable "domain" {
  description = "Fully-qualified domain name for the app (e.g. wheel.example.com)"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID for the parent domain (e.g. example.com)"
  type        = string
}

variable "image_tag" {
  description = "ECR image tag to deploy"
  type        = string
  default     = "latest"
}

variable "task_cpu" {
  description = "Fargate task CPU units"
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "Fargate task memory (MiB)"
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Number of ECS tasks to run"
  type        = number
  default     = 1
}

variable "dynamodb_read_capacity" {
  description = "DynamoDB read capacity (deprecated: tables use PAY_PER_REQUEST on-demand billing)"
  type        = number
  default     = 5
}

variable "dynamodb_write_capacity" {
  description = "DynamoDB write capacity (deprecated: tables use PAY_PER_REQUEST on-demand billing)"
  type        = number
  default     = 5
}

variable "oauth_google_client_id" {
  description = "Google OAuth client ID"
  type        = string
  default     = ""
}

variable "oauth_microsoft_client_id" {
  description = "Microsoft (Entra ID) OAuth client ID"
  type        = string
  default     = ""
}

variable "oauth_github_client_id" {
  description = "GitHub OAuth client ID"
  type        = string
  default     = ""
}

variable "admin_emails" {
  description = "Comma-separated list of email addresses that should be granted admin privileges (M2)"
  type        = string
  default     = ""
}

variable "donation_url" {
  description = "PayPal donation link (e.g. https://paypal.me/yourname) shown on the Buy a Dev a Coffee page"
  type        = string
  default     = ""
}

# ── Monitoring (monitoring.tf) ────────────────────────────────────────────────

variable "alarm_email" {
  description = "Email address for CloudWatch alarm notifications. AWS sends a confirmation link first. Leave empty to create the alarms without an email subscription."
  type        = string
  default     = ""
}

variable "alarm_latency_p95_seconds" {
  description = "Alarm when 95th percentile response time stays above this many seconds for 10 minutes"
  type        = number
  default     = 2
}

variable "alarm_requests_per_5min" {
  description = "Alarm when the load balancer receives more requests than this in 5 minutes (traffic spike or flood)"
  type        = number
  default     = 6000
}

variable "alarm_ses_sends_per_hour" {
  description = "Alarm when more emails than this are sent in an hour (signup or password-reset spam)"
  type        = number
  default     = 200
}

# ── Security services (security plan M10) ─────────────────────────────────────
# GuardDuty allows one detector per account and region, and organisations
# often run CloudTrail centrally. Turn these off if they're already managed
# elsewhere for this account.
variable "enable_guardduty" {
  description = "Create a GuardDuty detector for this account/region"
  type        = bool
  default     = true
}

variable "enable_cloudtrail" {
  description = "Create a CloudTrail trail with a locked, validated log bucket"
  type        = bool
  default     = true
}

variable "waf_auth_requests_per_5min" {
  description = "Per-IP limit on /api/auth/* requests at the WAF, per 5 minutes"
  type        = number
  default     = 300
}

variable "waf_requests_per_5min" {
  description = "Per-IP limit on all requests at the WAF, per 5 minutes"
  type        = number
  default     = 3000
}
