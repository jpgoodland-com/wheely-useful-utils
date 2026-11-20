const fs = require('fs')
const path = require('path')

const read = (file) => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8')

/** The lines of one `FROM ... AS <name>` stage, up to the next FROM. */
function stage(dockerfile, name) {
  const match = dockerfile.match(new RegExp(`^FROM\\s+\\S+\\s+AS\\s+${name}\\s*$([\\s\\S]*?)(?=^FROM\\s|(?![\\s\\S]))`, 'im'))
  return match ? match[1] : ''
}

/** The lines of one top-level docker-compose service. */
function service(compose, name) {
  const match = compose.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  \\S|(?![\\s\\S]))`, 'm'))
  return match ? match[1] : ''
}

describe('Container & Docker Configuration Tests', () => {
  let dockerfileContent
  let composeContent
  let dockerignoreContent
  let deployWorkflow

  beforeAll(() => {
    dockerfileContent = read('Dockerfile')
    composeContent = read('docker-compose.yml')
    dockerignoreContent = read('.dockerignore')
    deployWorkflow = read('.github/workflows/deploy.yml')
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
      expect(dockerfileContent).toMatch(/^ENV\s+PORT=3000$/m)
      expect(dockerfileContent).toMatch(/^ENV\s+HOSTNAME="0\.0\.0\.0"$/m)
    })

    it('uses Next.js standalone output tracing to minimize image footprint', () => {
      expect(dockerfileContent).toContain('/app/.next/standalone')
      expect(dockerfileContent).toContain('/app/.next/static')
    })

    it('disables anonymous Next.js telemetry in builder and runner stages', () => {
      expect(stage(dockerfileContent, 'builder')).toMatch(/^ENV\s+NEXT_TELEMETRY_DISABLED=1$/m)
      expect(stage(dockerfileContent, 'runner')).toMatch(/^ENV\s+NEXT_TELEMETRY_DISABLED=1$/m)
    })

    it('does not copy development node_modules into the production runner stage', () => {
      // Verifies devDependencies (like braces or eslint) do not bleed into the production container
      expect(dockerfileContent).not.toMatch(/COPY\s+--from=deps[^\n]*\/app\/node_modules[^\n]*runner/i)
      const runnerStage = dockerfileContent.split(/FROM\s+base\s+AS\s+runner/i)[1] || ''
      expect(runnerStage).not.toMatch(/COPY\s+--from=deps[^\n]*node_modules/i)
    })

    it('installs only production dependencies from the lockfile', () => {
      // next build needs no devDependencies, and skipping them cuts ~580 packages.
      const deps = stage(dockerfileContent, 'deps')
      expect(deps).toMatch(/^RUN\s+npm\s+ci\s+--omit=dev\s*$/m)
      expect(dockerfileContent).not.toMatch(/npm\s+(install|i)\b/)
    })

    it('copies patches before npm ci so the postinstall patch-package step finds them', () => {
      const deps = stage(dockerfileContent, 'deps')
      expect(deps.indexOf('COPY patches ./patches')).toBeGreaterThan(-1)
      expect(deps.indexOf('COPY patches ./patches')).toBeLessThan(deps.indexOf('npm ci'))
    })

    it('uses the ENV key=value form (no legacy "ENV key value" lines)', () => {
      const envLines = dockerfileContent.split('\n').filter((line) => /^ENV\s/.test(line))
      expect(envLines.length).toBeGreaterThan(0)
      for (const line of envLines) expect(line).toMatch(/^ENV\s+[A-Z_]+=\S+$/)
    })

    it('creates the runtime user and writable .next in a single layer', () => {
      const runner = stage(dockerfileContent, 'runner')
      expect(runner.match(/^RUN\s/gm)).toHaveLength(1)
      expect(runner).toMatch(/addgroup --system --gid 1001 nodejs[\s\\]*&& adduser --system --uid 1001 nextjs[\s\\]*&& mkdir \.next[\s\\]*&& chown nextjs:nodejs \.next/)
    })

    it('ships only the standalone server, static assets and public files in the runner', () => {
      const copies = stage(dockerfileContent, 'runner').match(/^COPY\s.*$/gm)
      expect(copies.map((line) => line.split(/\s+/).slice(-2)[0])).toEqual([
        '/app/.next/standalone',
        '/app/.next/static',
        '/app/public',
      ])
      // scripts/init-db.mjs is only for local and e2e setup, never production.
      expect(stage(dockerfileContent, 'runner')).not.toContain('scripts')
    })
  })

  describe('.dockerignore Build Context', () => {
    it.each(['node_modules', '.next', '.git', 'coverage', 'terraform/.terraform'])(
      'keeps %s out of the build context',
      (entry) => {
        expect(dockerignoreContent.split('\n').map((line) => line.trim())).toContain(entry)
      }
    )
  })

  describe('docker-compose.yml Local Environment', () => {
    it('maps web service to port 3000', () => {
      expect(composeContent).toMatch(/"3000:3000"/)
    })

    it('requires init-db to complete before launching the web service', () => {
      expect(service(composeContent, 'web')).toMatch(/init-db:\s*\n\s*condition: service_completed_successfully/)
    })

    it('runs init-db from the image deps stage instead of the host node_modules', () => {
      const initDb = service(composeContent, 'init-db')
      expect(initDb).toMatch(/build:\s*\n(\s+.*\n)*?\s+target: deps/)
      expect(initDb).not.toMatch(/node_modules/)
      expect(initDb).toMatch(/- \.\/scripts:\/app\/scripts:ro/)
      expect(initDb).toMatch(/command: \["node", "scripts\/init-db\.mjs"\]/)
    })

    it('lets init-db.mjs wait for DynamoDB Local instead of a fixed sleep', () => {
      expect(composeContent).not.toMatch(/\bsleep\b/)
    })

    it('exposes local DynamoDB on port 8000', () => {
      expect(composeContent).toMatch(/"8000:8000"/)
      expect(composeContent).toContain('amazon/dynamodb-local')
    })
  })

  describe('Deploy Workflow Image Build', () => {
    it('builds with Buildx and an ECR registry layer cache that cannot fail the deploy', () => {
      expect(deployWorkflow).toMatch(/uses: docker\/setup-buildx-action@v\d+/)
      expect(deployWorkflow).toMatch(/uses: docker\/build-push-action@v\d+/)
      // workflow_run jobs get read-only GitHub Actions cache tokens, so type=gha can't be written.
      expect(deployWorkflow).not.toMatch(/type=gha\b/)
      expect(deployWorkflow).toMatch(/cache-from: type=registry,ref=[^\n]+:buildcache$/m)
      const cacheTo = deployWorkflow.match(/cache-to: ([^\n]+)/)?.[1] ?? ''
      expect(cacheTo).toMatch(/^type=registry,ref=[^,]+:buildcache,/)
      expect(cacheTo).toContain('mode=max')
      expect(cacheTo).toContain('image-manifest=true')
      expect(cacheTo).toContain('ignore-error=true')
    })

    it('pushes the image ECS deploys, before forcing the new deployment', () => {
      expect(deployWorkflow).toMatch(/push: true/)
      expect(deployWorkflow).toContain('tags: ${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_REPOSITORY }}:latest')
      expect(deployWorkflow.indexOf('docker/build-push-action')).toBeLessThan(deployWorkflow.indexOf('--force-new-deployment'))
      expect(deployWorkflow).not.toMatch(/^\s*docker (build|push)\b/m)
    })
  })
})
