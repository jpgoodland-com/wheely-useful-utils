# ── Application KMS key ──────────────────────────────────────────────────────
# Customer-managed key for secrets the app stores in DynamoDB (TOTP seeds now,
# SSO client secrets later), used through lib/crypto/secretBox.js. Every call
# must carry an encryption context (see the task_kms policy), which binds each
# ciphertext to the user/record it belongs to.

resource "aws_kms_key" "app" {
  description             = "${var.app_name} application secrets"
  enable_key_rotation     = true
  deletion_window_in_days = 30

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AccountAdministration"
      Effect    = "Allow"
      Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
      Action    = "kms:*"
      Resource  = "*"
    }]
  })

  tags = { Name = "${var.app_name}-app" }
}

resource "aws_kms_alias" "app" {
  name          = "alias/${var.app_name}-app"
  target_key_id = aws_kms_key.app.key_id
}

# Separate key for DynamoDB table encryption, so the app key's
# encryption-context rule stays strict. Only DynamoDB may use it on the
# task's behalf (kms:ViaService in the task_kms_dynamodb policy).
resource "aws_kms_key" "dynamodb" {
  description             = "${var.app_name} DynamoDB tables"
  enable_key_rotation     = true
  deletion_window_in_days = 30

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AccountAdministration"
      Effect    = "Allow"
      Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
      Action    = "kms:*"
      Resource  = "*"
    }]
  })

  tags = { Name = "${var.app_name}-dynamodb" }
}

resource "aws_kms_alias" "dynamodb" {
  name          = "alias/${var.app_name}-dynamodb"
  target_key_id = aws_kms_key.dynamodb.key_id
}
