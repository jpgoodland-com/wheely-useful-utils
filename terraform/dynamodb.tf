# ── Users table ───────────────────────────────────────────────────────────────

resource "aws_dynamodb_table" "users" {
  name         = "WheelApp_Users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "EmailOrUsername"
    type = "S"
  }

  global_secondary_index {
    name            = "EmailOrUsernameIndex"
    hash_key        = "EmailOrUsername"
    projection_type = "ALL"
  }

  # Unverified signups carry expiresAt (epoch seconds) and are removed after
  # 7 days, so an email address can't be squatted. Verification clears it.
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  # Encryption at rest with the customer-managed key in kms.tf
  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.dynamodb.arn
  }

  # Backups: restore to any second in the last 35 days. Deletion protection
  # stops a mistaken `terraform destroy` or console click from losing data.
  point_in_time_recovery {
    enabled = true
  }
  deletion_protection_enabled = true

  tags = { Name = "WheelApp_Users" }
}

# ── Wheels table ──────────────────────────────────────────────────────────────

resource "aws_dynamodb_table" "wheels" {
  name         = "WheelApp_Wheels"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"

  attribute {
    name = "PK"
    type = "S"
  }

  # M4: GSI for efficient owner-based queries (replaces full-table Scan)
  attribute {
    name = "ownerId"
    type = "S"
  }

  global_secondary_index {
    name            = "OwnerIdIndex"
    hash_key        = "ownerId"
    projection_type = "ALL"
  }

  # Encryption at rest with the customer-managed key in kms.tf
  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.dynamodb.arn
  }

  # Backups: restore to any second in the last 35 days. Deletion protection
  # stops a mistaken `terraform destroy` or console click from losing data.
  point_in_time_recovery {
    enabled = true
  }
  deletion_protection_enabled = true

  tags = { Name = "WheelApp_Wheels" }
}

# ── Coin Flip table ───────────────────────────────────────────────────────────
# Per-user coin configurations and flip history
# (PK: COINFLIP#CONFIG#<userId> | COINFLIP#HISTORY#<userId>)

resource "aws_dynamodb_table" "coinflip" {
  name         = "WheelApp_CoinFlip"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"

  attribute {
    name = "PK"
    type = "S"
  }

  # Encryption at rest with the customer-managed key in kms.tf
  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.dynamodb.arn
  }

  # Backups: restore to any second in the last 35 days. Deletion protection
  # stops a mistaken `terraform destroy` or console click from losing data.
  point_in_time_recovery {
    enabled = true
  }
  deletion_protection_enabled = true

  tags = { Name = "WheelApp_CoinFlip" }
}

# ── Capacity Plans table ──────────────────────────────────────────────────────
# Team capacity plans, access (reverse index), availability and ownership quota
# (PK: PLAN#<id> | PLANACCESS#<planId>#<userId> | PLANAVAIL#<planId>#<memberId> | PLANQUOTA#<userId>)

resource "aws_dynamodb_table" "capacity_plans" {
  name         = "WheelApp_CapacityPlans"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"

  attribute {
    name = "PK"
    type = "S"
  }

  # Sparse GSI: only PLANACCESS items carry userId ("plans for user" listing)
  attribute {
    name = "userId"
    type = "S"
  }

  global_secondary_index {
    name            = "UserIdIndex"
    hash_key        = "userId"
    projection_type = "ALL"
  }

  # Encryption at rest with the customer-managed key in kms.tf
  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.dynamodb.arn
  }

  # Backups: restore to any second in the last 35 days. Deletion protection
  # stops a mistaken `terraform destroy` or console click from losing data.
  point_in_time_recovery {
    enabled = true
  }
  deletion_protection_enabled = true

  tags = { Name = "WheelApp_CapacityPlans" }
}

# ── Audit table ───────────────────────────────────────────────────────────────
# Append-only record of security and admin actions (security plan H12).
# The app may only Put and Query (iam.tf), so it can't edit or delete history.
# (PK: AUDIT#<ts>#<random>; ScopeIndex: scope "platform" | "user#<id>", ts)

resource "aws_dynamodb_table" "audit" {
  name         = "WheelApp_Audit"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "scope"
    type = "S"
  }

  attribute {
    name = "ts"
    type = "S"
  }

  global_secondary_index {
    name            = "ScopeIndex"
    hash_key        = "scope"
    range_key       = "ts"
    projection_type = "ALL"
  }

  # Records expire after 400 days (a year of evidence plus margin).
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  # Encryption at rest with the customer-managed key in kms.tf
  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.dynamodb.arn
  }

  # Backups: restore to any second in the last 35 days. Deletion protection
  # stops a mistaken `terraform destroy` or console click from losing data.
  point_in_time_recovery {
    enabled = true
  }
  deletion_protection_enabled = true

  tags = { Name = "WheelApp_Audit" }
}
