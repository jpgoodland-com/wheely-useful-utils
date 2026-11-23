const fs = require('fs')
const path = require('path')
const { readTfFile, getResourceBlock, getResourceBlocks } = require('./helpers/tfHelper')

describe('Infrastructure Security Configuration Tests', () => {
  describe('Network & Security Groups (networking.tf)', () => {
    let netContent

    beforeAll(() => {
      netContent = readTfFile('networking.tf')
    })

    it('configures ALB security group to accept only port 80 and 443 from internet', () => {
      const albSg = getResourceBlock(netContent, 'aws_security_group', 'alb')
      expect(albSg).not.toBeNull()

      expect(albSg).toMatch(/from_port\s*=\s*80[\s\S]*to_port\s*=\s*80/)
      expect(albSg).toMatch(/from_port\s*=\s*443[\s\S]*to_port\s*=\s*443/)
      // Should not expose application port 3000 on the ALB SG
      expect(albSg).not.toMatch(/from_port\s*=\s*3000/)
    })

    it('isolates ECS application security group to accept traffic ONLY from ALB security group', () => {
      const appSg = getResourceBlock(netContent, 'aws_security_group', 'app')
      expect(appSg).not.toBeNull()

      // Ingress on port 3000 from ALB security group only
      expect(appSg).toMatch(/from_port\s*=\s*3000/)
      expect(appSg).toMatch(/to_port\s*=\s*3000/)
      expect(appSg).toMatch(/security_groups\s*=\s*\[aws_security_group\.alb\.id\]/)

      // Ensure ingress does NOT allow public 0.0.0.0/0 or ::/0
      const ingressBlockMatch = appSg.match(/ingress\s*\{[\s\S]*?\}/)
      expect(ingressBlockMatch).not.toBeNull()
      const ingressBlock = ingressBlockMatch[0]
      expect(ingressBlock).not.toContain('"0.0.0.0/0"')
      expect(ingressBlock).not.toContain('"::/0"')
    })
  })

  describe('ALB & TLS Listeners (alb.tf)', () => {
    let albContent

    beforeAll(() => {
      albContent = readTfFile('alb.tf')
    })

    it('enforces HTTP to HTTPS permanent 301 redirection on port 80', () => {
      const redirectListener = getResourceBlock(albContent, 'aws_lb_listener', 'http_redirect')
      expect(redirectListener).not.toBeNull()
      expect(redirectListener).toMatch(/port\s*=\s*80/)
      expect(redirectListener).toMatch(/protocol\s*=\s*"HTTP"/)
      expect(redirectListener).toMatch(/status_code\s*=\s*"HTTP_301"/)
      expect(redirectListener).toMatch(/protocol\s*=\s*"HTTPS"/)
    })

    it('enforces modern TLS 1.3/1.2 security policy on port 443', () => {
      const httpsListener = getResourceBlock(albContent, 'aws_lb_listener', 'https')
      expect(httpsListener).not.toBeNull()
      expect(httpsListener).toMatch(/port\s*=\s*443/)
      expect(httpsListener).toMatch(/protocol\s*=\s*"HTTPS"/)
      expect(httpsListener).toMatch(/ssl_policy\s*=\s*"ELBSecurityPolicy-TLS13-1-2-2021-06"/)
    })
  })

  describe('IAM Least Privilege Policies (iam.tf)', () => {
    let iamContent

    beforeAll(() => {
      iamContent = readTfFile('iam.tf')
    })

    it('scopes DynamoDB permissions strictly to table and index ARNs (no wildcard resources)', () => {
      const dynamoPolicy = getResourceBlock(iamContent, 'aws_iam_role_policy', 'task_dynamodb')
      expect(dynamoPolicy).not.toBeNull()

      // Actions must be standard CRUD operations
      expect(dynamoPolicy).toContain('"dynamodb:GetItem"')
      expect(dynamoPolicy).toContain('"dynamodb:PutItem"')
      expect(dynamoPolicy).toContain('"dynamodb:Query"')

      // Resources must be explicitly specified table ARNs and indexes
      expect(dynamoPolicy).toContain('aws_dynamodb_table.users.arn')
      expect(dynamoPolicy).toContain('aws_dynamodb_table.wheels.arn')
      expect(dynamoPolicy).toContain('aws_dynamodb_table.coinflip.arn')
      expect(dynamoPolicy).toContain('aws_dynamodb_table.capacity_plans.arn')

      // Must NOT grant global wildcard access to all DynamoDB tables
      expect(dynamoPolicy).not.toMatch(/"Resource"\s*:\s*"\*"/)
    })

    it('restricts SES sending permissions with a sender address condition', () => {
      const sesPolicy = getResourceBlock(iamContent, 'aws_iam_role_policy', 'task_ses')
      expect(sesPolicy).not.toBeNull()
      expect(sesPolicy).toContain('"ses:SendEmail"')
      expect(sesPolicy).toContain('"ses:FromAddress" = "no-reply@${var.domain}"')
    })

    it('makes the audit table append-only for the app', () => {
      const audit = getResourceBlock(iamContent, 'aws_iam_role_policy', 'task_audit')
      expect(audit).toMatch(/Action = \["dynamodb:PutItem", "dynamodb:Query"\]/)
      expect(audit).toContain('aws_dynamodb_table.audit.arn')
      // No other policy may grant write access to it.
      const dynamo = getResourceBlock(iamContent, 'aws_iam_role_policy', 'task_dynamodb')
      expect(dynamo).not.toContain('aws_dynamodb_table.audit')
    })

    it('scopes KMS use to the app key and requires an encryption context', () => {
      const kmsPolicy = getResourceBlock(iamContent, 'aws_iam_role_policy', 'task_kms')
      expect(kmsPolicy).not.toBeNull()
      expect(kmsPolicy).toMatch(/Action\s*=\s*\["kms:Encrypt", "kms:Decrypt"\]/)
      expect(kmsPolicy).toMatch(/Resource\s*=\s*aws_kms_key\.app\.arn/)
      expect(kmsPolicy).toContain('"kms:EncryptionContextKeys" = "false"')
      expect(kmsPolicy).not.toMatch(/kms:\*/)
    })

    it('scopes Secrets Manager access to specific secret ARNs', () => {
      const secretsPolicy = getResourceBlock(iamContent, 'aws_iam_role_policy', 'task_exec_secrets')
      expect(secretsPolicy).not.toBeNull()
      expect(secretsPolicy).toContain('"secretsmanager:GetSecretValue"')
      // Sessions are server-side; the old JWT signing secret must not come back.
      expect(secretsPolicy).not.toContain('jwt_secret')
      expect(secretsPolicy).toContain('aws_secretsmanager_secret.oauth_google.arn')
      expect(secretsPolicy).toContain('aws_secretsmanager_secret.oauth_microsoft.arn')
      expect(secretsPolicy).toContain('aws_secretsmanager_secret.oauth_github.arn')
      expect(secretsPolicy).not.toMatch(/"Resource"\s*:\s*"\*"/)
    })
  })

  describe('Secrets & Environment Security (ecs.tf, oauth.tf)', () => {
    let ecsContent
    let oauthContent

    beforeAll(() => {
      ecsContent = readTfFile('ecs.tf')
      oauthContent = readTfFile('oauth.tf')
    })

    it('injects sensitive secrets via Secrets Manager ARNs, never in plaintext environment', () => {
      const taskBlock = getResourceBlock(ecsContent, 'aws_ecs_task_definition', 'app')
      expect(taskBlock).not.toBeNull()

      // Environment variables must NOT contain secret values
      expect(taskBlock).not.toMatch(/name\s*=\s*"JWT_SECRET"[\s\S]*value\s*=/)
      expect(taskBlock).not.toMatch(/name\s*=\s*"OAUTH_GOOGLE_CLIENT_SECRET"[\s\S]*value\s*=/)

      // Secrets must be injected via Secrets Manager valueFrom
      expect(taskBlock).not.toContain('JWT_SECRET')
      expect(taskBlock).toContain('aws_secretsmanager_secret.oauth_google.arn')
      expect(taskBlock).toContain('aws_secretsmanager_secret.oauth_microsoft.arn')
      expect(taskBlock).toContain('aws_secretsmanager_secret.oauth_github.arn')
    })

    it('configures lifecycle ignore_changes on secret versions to prevent leaking secrets in terraform state', () => {
      expect(oauthContent).toContain('ignore_changes = [secret_string]')
    })

    it('has no JWT signing secret (sessions are server-side)', () => {
      expect(fs.existsSync(path.join(__dirname, '../../terraform/secrets.tf'))).toBe(false)
    })
  })

  describe('Application KMS key (kms.tf)', () => {
    let kmsContent
    beforeAll(() => {
      kmsContent = readTfFile('kms.tf')
    })

    it('rotates the key and keeps a 30-day deletion window', () => {
      const key = getResourceBlock(kmsContent, 'aws_kms_key', 'app')
      expect(key).toMatch(/enable_key_rotation\s*=\s*true/)
      expect(key).toMatch(/deletion_window_in_days\s*=\s*30/)
    })

    it('passes the key to the app as APP_KMS_KEY_ID', () => {
      expect(readTfFile('ecs.tf')).toMatch(/name = "APP_KMS_KEY_ID", value = aws_kms_key\.app\.arn/)
    })
  })

  describe('DynamoDB Encryption at Rest (dynamodb.tf)', () => {
    let ddbContent
    let tables

    beforeAll(() => {
      ddbContent = readTfFile('dynamodb.tf')
      tables = getResourceBlocks(ddbContent, 'aws_dynamodb_table')
    })

    it('enables server-side encryption across all DynamoDB tables', () => {
      tables.forEach((table) => {
        expect(table.content).toMatch(/server_side_encryption\s*\{[\s\S]*enabled\s*=\s*true[\s\S]*\}/)
      })
    })
  })
})
