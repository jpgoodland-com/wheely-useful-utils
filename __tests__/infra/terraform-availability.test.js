const { readTfFile, getResourceBlock } = require('./helpers/tfHelper')

// Keep a healthy target through Spot interruptions, deploys and the
// loss of one task.
describe('Availability (ecs.tf, alb.tf)', () => {
  let service
  let targetGroup

  beforeAll(() => {
    service = getResourceBlock(readTfFile('ecs.tf'), 'aws_ecs_service', 'app')
    targetGroup = getResourceBlock(readTfFile('alb.tf'), 'aws_lb_target_group', 'app')
  })

  it('runs the service in subnets across both AZs', () => {
    expect(service).toMatch(/subnets\s*=\s*aws_subnet\.public\[\*\]\.id/)
  })

  it('gives new tasks a health check grace period', () => {
    const m = service.match(/health_check_grace_period_seconds\s*=\s*(\d+)/)
    expect(m).not.toBeNull()
    expect(Number(m[1])).toBeGreaterThanOrEqual(30)
    expect(Number(m[1])).toBeLessThanOrEqual(120)
  })

  it('health-checks the dedicated endpoint', () => {
    expect(targetGroup).toMatch(/path\s*=\s*"\/api\/health"/)
  })

  it('drains targets within the 2-minute Spot interruption warning', () => {
    const m = targetGroup.match(/deregistration_delay\s*=\s*(\d+)/)
    expect(m).not.toBeNull()
    expect(Number(m[1])).toBeLessThan(120)
  })
})
