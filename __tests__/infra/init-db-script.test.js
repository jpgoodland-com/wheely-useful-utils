const http = require('http')
const path = require('path')
const { spawn } = require('child_process')

// Runs scripts/init-db.mjs as docker compose and the e2e setup do, against a
// minimal fake of the two DynamoDB calls it makes.

const SCRIPT = path.resolve(__dirname, '../../scripts/init-db.mjs')
const APP_TABLES = ['WheelApp_Users', 'WheelApp_Wheels', 'WheelApp_CoinFlip', 'WheelApp_CapacityPlans', 'WheelApp_Audit']

function runInitDb(endpoint, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], {
      env: {
        PATH: process.env.PATH,
        AWS_REGION: 'us-west-2',
        AWS_ACCESS_KEY_ID: 'fakeMyKeyId',
        AWS_SECRET_ACCESS_KEY: 'fakeSecretAccessKey',
        // One SDK attempt per call, so the script's own retry is what's tested.
        AWS_MAX_ATTEMPTS: '1',
        DYNAMODB_ENDPOINT: endpoint,
        ...extraEnv,
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

/** Fake DynamoDB: answers ListTables and records CreateTable calls. */
function fakeDynamo(existingTables = []) {
  const created = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      const op = String(req.headers['x-amz-target']).split('.').pop()
      res.setHeader('Content-Type', 'application/x-amz-json-1.0')
      if (op === 'ListTables') {
        res.end(JSON.stringify({ TableNames: [...existingTables, ...created.map((t) => t.TableName)] }))
      } else if (op === 'CreateTable') {
        const input = JSON.parse(body)
        created.push(input)
        res.end(JSON.stringify({ TableDescription: { TableName: input.TableName, TableStatus: 'ACTIVE' } }))
      } else {
        res.statusCode = 400
        res.end(JSON.stringify({ __type: 'UnknownOperationException' }))
      }
    })
  })
  return { server, created }
}

function listen(server, port = 0) {
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address().port)))
}

/** A free local port with nothing listening on it. */
async function unusedPort() {
  const probe = http.createServer()
  const port = await listen(probe)
  await new Promise((resolve) => probe.close(resolve))
  return port
}

describe('scripts/init-db.mjs', () => {
  const servers = []
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))))
  })

  it('creates every app table on an empty database and exits 0', async () => {
    const { server, created } = fakeDynamo()
    servers.push(server)
    const port = await listen(server)

    const { code, stdout } = await runInitDb(`http://127.0.0.1:${port}`)

    expect(code).toBe(0)
    expect(created.map((t) => t.TableName)).toEqual(APP_TABLES)
    expect(stdout).toContain('Database initialized.')
    expect(stdout).not.toContain('Waiting for DynamoDB')
  })

  it('is idempotent: creates nothing when the tables already exist', async () => {
    const { server, created } = fakeDynamo(APP_TABLES)
    servers.push(server)
    const port = await listen(server)

    const { code, stdout } = await runInitDb(`http://127.0.0.1:${port}`)

    expect(code).toBe(0)
    expect(created).toHaveLength(0)
    expect(stdout).toContain('Database initialized.')
  })

  it('waits for DynamoDB to start accepting connections instead of failing', async () => {
    const port = await unusedPort()
    const { server, created } = fakeDynamo()
    servers.push(server)
    // Nothing is listening yet; start the fake after the script's first attempt.
    let started
    const timer = setTimeout(() => (started = listen(server, port)), 300)

    const { code, stdout } = await runInitDb(`http://127.0.0.1:${port}`, { INIT_DB_ATTEMPTS: '5' })
    // If the script gave up before the fake started, don't leave it to start
    // after afterEach and keep Jest alive.
    clearTimeout(timer)
    await started

    expect(code).toBe(0)
    expect(stdout).toContain(`Waiting for DynamoDB at http://127.0.0.1:${port} (1/5)...`)
    expect(created.map((t) => t.TableName)).toEqual(APP_TABLES)
  })

  it('exits non-zero after its attempts run out, so compose and the e2e setup stop', async () => {
    const port = await unusedPort()

    const { code, stdout, stderr } = await runInitDb(`http://127.0.0.1:${port}`, { INIT_DB_ATTEMPTS: '2' })

    expect(code).toBe(1)
    expect(stdout).toContain('(1/2)')
    expect(stdout).not.toContain('(2/2)')
    expect(stdout).not.toContain('Database initialized.')
    expect(stderr).toMatch(/ECONNREFUSED/)
  })
})
