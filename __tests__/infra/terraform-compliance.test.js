/**
 * SOC 2 / ISO 27001 infrastructure controls (security plan finding M10).
 */
const { readTfFile, getResourceBlock, getResourceBlocks } = require('./helpers/tfHelper')

describe('DynamoDB backups and encryption (dynamodb.tf)', () => {
  const tables = getResourceBlocks(readTfFile('dynamodb.tf'), 'aws_dynamodb_table')

  it.each(tables.map((t) => [t.name, t.content]))('%s has PITR, deletion protection and the customer-managed key', (_name, content) => {
    expect(content).toMatch(/point_in_time_recovery\s*\{\s*enabled\s*=\s*true\s*\}/)
    expect(content).toMatch(/deletion_protection_enabled\s*=\s*true/)
    expect(content).toMatch(/kms_key_arn\s*=\s*aws_kms_key\.dynamodb\.arn/)
  })

  it('lets the task use the table key only through DynamoDB', () => {
    const policy = getResourceBlock(readTfFile('iam.tf'), 'aws_iam_role_policy', 'task_kms_dynamodb')
    expect(policy).toMatch(/Resource\s*=\s*aws_kms_key\.dynamodb\.arn/)
    expect(policy).toContain('"kms:ViaService" = "dynamodb.${var.aws_region}.amazonaws.com"')
  })
})

describe('KMS keys (kms.tf)', () => {
  const keys = getResourceBlocks(readTfFile('kms.tf'), 'aws_kms_key')
  it.each(keys.map((k) => [k.name, k.content]))('%s rotates and has a 30-day deletion window', (_name, content) => {
    expect(content).toMatch(/enable_key_rotation\s*=\s*true/)
    expect(content).toMatch(/deletion_window_in_days\s*=\s*30/)
  })
})

describe('AWS WAF (waf.tf)', () => {
  const waf = readTfFile('waf.tf')
  const acl = getResourceBlock(waf, 'aws_wafv2_web_acl', 'app')

  it('is attached to the load balancer', () => {
    expect(getResourceBlock(waf, 'aws_wafv2_web_acl_association', 'alb')).toMatch(/resource_arn\s*=\s*aws_lb\.app\.arn/)
  })

  it('uses the AWS managed common, bad-input and IP-reputation rule groups', () => {
    for (const group of ['AWSManagedRulesCommonRuleSet', 'AWSManagedRulesKnownBadInputsRuleSet', 'AWSManagedRulesAmazonIpReputationList']) {
      expect(acl).toContain(`name        = "${group}"`)
    }
  })

  it('rate-limits /api/auth/ and all traffic per IP, blocking', () => {
    expect(acl).toContain('search_string         = "/api/auth/"')
    expect(acl).toMatch(/limit\s*=\s*var\.waf_auth_requests_per_5min/)
    expect(acl).toMatch(/limit\s*=\s*var\.waf_requests_per_5min/)
    expect((acl.match(/action \{\s*block \{\}/g) || []).length).toBe(2)
  })

  it('logs blocked requests for a year', () => {
    expect(getResourceBlock(waf, 'aws_cloudwatch_log_group', 'waf')).toMatch(/retention_in_days\s*=\s*365/)
    expect(getResourceBlock(waf, 'aws_wafv2_web_acl_logging_configuration', 'app')).toContain('action = "BLOCK"')
  })
})

describe('Audit trail (audit.tf)', () => {
  const audit = readTfFile('audit.tf')

  it('runs a multi-region CloudTrail with log file validation', () => {
    const trail = getResourceBlock(audit, 'aws_cloudtrail', 'main')
    expect(trail).toMatch(/is_multi_region_trail\s*=\s*true/)
    expect(trail).toMatch(/enable_log_file_validation\s*=\s*true/)
    expect(trail).toContain('aws_dynamodb_table.users.arn')
  })

  it('locks CloudTrail records for a year in COMPLIANCE mode', () => {
    const lock = getResourceBlock(audit, 'aws_s3_bucket_object_lock_configuration', 'cloudtrail')
    expect(lock).toContain('mode = "COMPLIANCE"')
    expect(audit).toMatch(/log_retention_days = 365/)
    expect(getResourceBlock(audit, 'aws_s3_bucket', 'cloudtrail')).toMatch(/object_lock_enabled\s*=\s*true/)
  })

  it.each(['alb_logs', 'cloudtrail'])('keeps the %s bucket private, encrypted and HTTPS-only', (bucket) => {
    const block = getResourceBlock(audit, 'aws_s3_bucket_public_access_block', bucket)
    for (const flag of ['block_public_acls', 'block_public_policy', 'ignore_public_acls', 'restrict_public_buckets']) {
      expect(block).toMatch(new RegExp(`${flag}\\s*=\\s*true`))
    }
    expect(getResourceBlock(audit, 'aws_s3_bucket_server_side_encryption_configuration', bucket)).toContain('sse_algorithm')
    expect(getResourceBlock(audit, 'aws_s3_bucket_policy', bucket)).toContain('"aws:SecureTransport" = "false"')
  })

  it('enables GuardDuty', () => {
    expect(getResourceBlock(audit, 'aws_guardduty_detector', 'main')).toMatch(/enable\s*=\s*true/)
  })

  it('sends ALB access logs to the log bucket and drops invalid headers', () => {
    const alb = getResourceBlock(readTfFile('alb.tf'), 'aws_lb', 'app')
    expect(alb).toMatch(/access_logs\s*\{[\s\S]*bucket\s*=\s*aws_s3_bucket\.alb_logs\.id[\s\S]*enabled\s*=\s*true/)
    expect(alb).toMatch(/drop_invalid_header_fields\s*=\s*true/)
  })

  it('creates the log bucket policy before turning on ALB access logs', () => {
    // AWS validates the bucket by writing to it when logs are enabled.
    const alb = getResourceBlock(readTfFile('alb.tf'), 'aws_lb', 'app')
    expect(alb).toMatch(/depends_on\s*=\s*\[aws_s3_bucket_policy\.alb_logs\]/)
  })
})

describe('Log retention', () => {
  it('keeps every CloudWatch log group for a year', () => {
    for (const file of ['ecs.tf', 'monitoring.tf', 'waf.tf']) {
      for (const { name, content } of getResourceBlocks(readTfFile(file), 'aws_cloudwatch_log_group')) {
        expect({ file, name, ok: /retention_in_days\s*=\s*365/.test(content) }).toEqual({ file, name, ok: true })
      }
    }
  })
})
