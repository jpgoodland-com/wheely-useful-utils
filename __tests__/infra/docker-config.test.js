const fs = require('fs')
const path = require('path')

describe('Container & Docker Configuration Tests', () => {
  let dockerfileContent
  let composeContent

  beforeAll(() => {
    dockerfileContent = fs.readFileSync(path.resolve(__dirname, '../../Dockerfile'), 'utf8')
    composeContent = fs.readFileSync(path.resolve(__dirname, '../../docker-compose.yml'), 'utf8')
  })

  describe('Dockerfile Security & Optimization', () => {
    it('uses a multi-stage build to isolate build tools from runtime', () => {
      expect(dockerfileContent).toMatch(/FROM\s+node:\S+\s+AS\s+base/i)
      expect(dockerfileContent).toMatch(/FROM\s+base\s+AS\s+deps/i)
      expect(dockerfileContent).toMatch(/FROM\s+base\s+AS\s+builder/i)
      expect(dockerfileContent).toMatch(/FROM\s+base\s+AS\s+runner/i)
    })

    it('runs as non-root user (nextjs) in the production runner stage', () => {
      expect(dockerfileContent).toContain('adduser --system --uid 1001 nextjs')
      expect(dockerfileContent).toMatch(/USER\s+nextjs/)
    })

    it('exposes and binds to port 3000 on 0.0.0.0', () => {
      expect(dockerfileContent).toMatch(/EXPOSE\s+3000/)
      expect(dockerfileContent).toMatch(/ENV\s+PORT\s+3000/)
      expect(dockerfileContent).toMatch(/ENV\s+HOSTNAME\s+"0\.0\.0\.0"/)
    })

    it('uses Next.js standalone output tracing to minimize image footprint', () => {
      expect(dockerfileContent).toContain('/app/.next/standalone')
      expect(dockerfileContent).toContain('/app/.next/static')
    })

    it('disables anonymous Next.js telemetry in builder and runner stages', () => {
      const telemetryMatches = dockerfileContent.match(/NEXT_TELEMETRY_DISABLED\s+1/g)
      expect(telemetryMatches).not.toBeNull()
      expect(telemetryMatches.length).toBeGreaterThanOrEqual(2)
    })

    it('does not copy development node_modules into the production runner stage', () => {
      // Verifies devDependencies (like braces or eslint) do not bleed into the production container
      expect(dockerfileContent).not.toMatch(/COPY\s+--from=deps[^\n]*\/app\/node_modules[^\n]*runner/i)
      const runnerStage = dockerfileContent.split(/FROM\s+base\s+AS\s+runner/i)[1] || ''
      expect(runnerStage).not.toMatch(/COPY\s+--from=deps[^\n]*node_modules/i)
    })
  })

  describe('docker-compose.yml Local Environment', () => {
    it('maps web service to port 3000', () => {
      expect(composeContent).toMatch(/"3000:3000"/)
    })

    it('requires init-db to complete before launching the web service', () => {
      expect(composeContent).toContain('init-db:')
      expect(composeContent).toContain('condition: service_completed_successfully')
    })

    it('exposes local DynamoDB on port 8000', () => {
      expect(composeContent).toMatch(/"8000:8000"/)
      expect(composeContent).toContain('amazon/dynamodb-local')
    })
  })
})
