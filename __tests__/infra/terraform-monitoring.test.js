const fs = require('fs')
const path = require('path')
const { readTfFile, getResourceBlock, getResourceBlocks } = require('./helpers/tfHelper')

const ROOT = path.resolve(__dirname, '../..')

describe('Monitoring & Alerting (monitoring.tf)', () => {
  let content
  let alarms

  beforeAll(() => {
    content = readTfFile('monitoring.tf')
    alarms = getResourceBlocks(content, 'aws_cloudwatch_metric_alarm')
  })

  describe('notifications', () => {
    it('creates an SNS topic for alerts', () => {
      expect(getResourceBlock(content, 'aws_sns_topic', 'alerts')).not.toBeNull()
    })

    it('subscribes var.alarm_email only when it is set', () => {
      const sub = getResourceBlock(content, 'aws_sns_topic_subscription', 'alerts_email')
      expect(sub).toMatch(/count\s*=\s*var\.alarm_email == "" \? 0 : 1/)
      expect(sub).toMatch(/protocol\s*=\s*"email"/)
      expect(sub).toMatch(/endpoint\s*=\s*var\.alarm_email/)
    })

    it('limits topic publishing to CloudWatch and EventBridge in this account', () => {
      const policy = getResourceBlock(content, 'aws_sns_topic_policy', 'alerts')
      expect(policy).toContain('cloudwatch.amazonaws.com')
      expect(policy).toContain('events.amazonaws.com')
      expect(policy).toContain('aws:SourceAccount')
    })

    it('passes the alarm email from a GitHub secret in the Terraform workflow', () => {
      const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/terraform.yml'), 'utf8')
      expect(wf.match(/TF_VAR_alarm_email: \$\{\{ secrets\.ALARM_EMAIL \}\}/g)).toHaveLength(2)
    })
  })

  describe('alarms', () => {
    it('covers availability, latency/scaling, security, email and database signals', () => {
      const names = alarms.map((a) => a.name).sort()
      expect(names).toEqual([
        'app_errors',
        'client_4xx_spike',
        'dynamodb_throttles',
        'ecs_cpu_high',
        'ecs_memory_high',
        'elb_5xx',
        'latency_p95',
        'login_failures',
        'no_healthy_targets',
        'rate_limited_clients',
        'request_spike',
        'ses_bounce_rate',
        'ses_complaint_rate',
        'ses_send_spike',
        'target_5xx_rate',
        'unhealthy_targets',
      ])
    })

    it('notifies the topic on alarm and on recovery, with a description and explicit missing-data handling', () => {
      for (const { name, content: block } of alarms) {
        expect({ name, ok: /alarm_actions\s*=\s*local\.alarm_actions/.test(block) }).toEqual({ name, ok: true })
        expect({ name, ok: /ok_actions\s*=\s*local\.alarm_actions/.test(block) }).toEqual({ name, ok: true })
        expect({ name, ok: /alarm_description\s*=/.test(block) }).toEqual({ name, ok: true })
        expect({ name, ok: /treat_missing_data\s*=/.test(block) }).toEqual({ name, ok: true })
        expect({ name, ok: /alarm_name\s*=\s*"\$\{var\.app_name\}-/.test(block) }).toEqual({ name, ok: true })
      }
      expect(content).toMatch(/alarm_actions\s*=\s*\[aws_sns_topic\.alerts\.arn\]/)
    })

    it('treats missing health data as down, so a vanished target still alarms', () => {
      const block = getResourceBlock(content, 'aws_cloudwatch_metric_alarm', 'no_healthy_targets')
      expect(block).toMatch(/treat_missing_data\s*=\s*"breaching"/)
    })

    it('shows every alarm on the dashboard', () => {
      for (const { name } of alarms) {
        expect(content).toContain(`aws_cloudwatch_metric_alarm.${name}.arn`)
      }
    })

    it('avoids anomaly detection alarms (3x the cost of static thresholds)', () => {
      expect(content).not.toMatch(/ANOMALY_DETECTION_BAND/)
    })
  })

  describe('security event metrics', () => {
    const appEventNames = () => {
      const files = ['proxy.js', 'app/api/auth/login/route.js']
      const names = new Set()
      for (const f of files) {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
        for (const m of src.matchAll(/logSecurityEvent\(\s*['"]([a-z_]+)['"]/g)) names.add(m[1])
      }
      return [...names].sort()
    }

    it('has a metric filter for every security event the app logs', () => {
      const names = appEventNames()
      expect(names).toEqual(['login_failed', 'rate_limited'])
      const filters = getResourceBlocks(content, 'aws_cloudwatch_log_metric_filter').map((f) => f.content).join('\n')
      for (const name of names) expect(filters).toContain(`$.securityEvent = \\"${name}\\"`)
    })

    it('reads the app log group and adds no dimensions (one custom metric per filter)', () => {
      for (const { name, content: block } of getResourceBlocks(content, 'aws_cloudwatch_log_metric_filter')) {
        expect({ name, ok: /log_group_name\s*=\s*aws_cloudwatch_log_group\.app\.name/.test(block) }).toEqual({ name, ok: true })
        expect({ name, dims: /dimensions/.test(block) }).toEqual({ name, dims: false })
      }
    })
  })

  describe('ECS events and deployments', () => {
    it('emails on unexpected task stops but not normal deployments', () => {
      const rule = getResourceBlock(content, 'aws_cloudwatch_event_rule', 'ecs_task_stopped')
      expect(rule).toContain('SpotInterruption')
      expect(rule).toContain('EssentialContainerExited')
      expect(rule).not.toContain('ServiceSchedulerInitiated')
    })

    it('logs every stopped task, with its reason, to a dedicated log group', () => {
      const rule = getResourceBlock(content, 'aws_cloudwatch_event_rule', 'ecs_task_stopped_log')
      expect(rule).toMatch(/lastStatus\s*=\s*\["STOPPED"\]/)
      expect(rule).not.toContain('stopCode')

      const target = getResourceBlock(content, 'aws_cloudwatch_event_target', 'ecs_task_stopped_log')
      expect(target).toMatch(/arn\s*=\s*aws_cloudwatch_log_group\.ecs_events\.arn/)
      expect(target).not.toContain('aws_sns_topic')

      const group = getResourceBlock(content, 'aws_cloudwatch_log_group', 'ecs_events')
      expect(group).toMatch(/name\s*=\s*"\/aws\/events\//)
      expect(group).toMatch(/retention_in_days\s*=\s*30/)

      const policy = getResourceBlock(content, 'aws_cloudwatch_log_resource_policy', 'ecs_events')
      expect(policy).toContain('events.amazonaws.com')
      expect(policy).toContain('aws_cloudwatch_log_group.ecs_events.arn')
    })

    it('rolls back failed deployments so the deployment-failed notification can fire', () => {
      const service = getResourceBlock(readTfFile('ecs.tf'), 'aws_ecs_service', 'app')
      expect(service).toMatch(/deployment_circuit_breaker\s*\{[^}]*enable\s*=\s*true[^}]*rollback\s*=\s*true/)
      expect(getResourceBlock(content, 'aws_cloudwatch_event_rule', 'ecs_deployment_failed')).toContain('SERVICE_DEPLOYMENT_FAILED')
    })
  })

  it('creates a single operations dashboard', () => {
    const dashboards = getResourceBlocks(content, 'aws_cloudwatch_dashboard')
    expect(dashboards.map((d) => d.name)).toEqual(['operations'])
  })
})
