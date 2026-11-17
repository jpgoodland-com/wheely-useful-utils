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

  # Encryption at rest using AWS-managed KMS key
  server_side_encryption {
    enabled = true
  }

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

  # Encryption at rest using AWS-managed KMS key
  server_side_encryption {
    enabled = true
  }

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

  # Encryption at rest using AWS-managed KMS key
  server_side_encryption {
    enabled = true
  }

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

  # Encryption at rest using AWS-managed KMS key
  server_side_encryption {
    enabled = true
  }

  tags = { Name = "WheelApp_CapacityPlans" }
}
