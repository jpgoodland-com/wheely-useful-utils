
jest.mock('@/lib/dynamodb', () => {
  const { createFakeDynamo } = require('@/__tests__/helpers/fakeDynamo')
  return { docClient: createFakeDynamo(), TableNames: { Users: 'WheelApp_Users' } }
})

// Mock rate limiting
jest.mock('@/lib/rateLimit', () => ({
  checkRateLimit: jest.fn().mockReturnValue({ allowed: true, resetMs: Date.now() + 1000 })
}))

jest.mock('@/lib/securityLog', () => ({ logSecurityEvent: jest.fn() }))

const bcrypt = require('bcrypt')
const { POST } = require('@/app/api/auth/login/route')
const { docClient } = require('@/lib/dynamodb')
const { logSecurityEvent } = require('@/lib/securityLog')
const { checkRateLimit } = require('@/lib/rateLimit')
const { seedUser, USERS_TABLE } = require('@/__tests__/helpers/users')

const PASSWORD = 'Correct-horse-9!'
const HASH = bcrypt.hashSync(PASSWORD, 4)

function makeRequest(body, headers = {}) {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  docClient.reset()
  checkRateLimit.mockReturnValue({ allowed: true, resetMs: Date.now() + 1000 })
  seedUser(docClient, { userId: 'u1', username: 'alice', email: 'alice@example.com', password: HASH })
})

describe('POST /api/auth/login', () => {
  it('signs in by username and sets the cookie', async () => {
    const res = await POST(makeRequest({ identifier: 'alice', password: PASSWORD }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ success: true, userId: 'u1', username: 'alice', firstName: null, lastName: null })
    expect(res.headers.get('set-cookie')).toMatch(/(^|, )session=[^;]+/)
  })

  it('signs in by email, case-insensitively', async () => {
    const res = await POST(makeRequest({ identifier: 'Alice@Example.com', password: PASSWORD }))
    expect(res.status).toBe(200)
  })

  it('returns firstName and lastName when present on user', async () => {
    seedUser(docClient, { userId: 'u3', username: 'carol', password: HASH, firstName: 'Carol', lastName: 'Smith' })
    const res = await POST(makeRequest({ identifier: 'carol', password: PASSWORD }))
    const body = await res.json()
    expect(body.firstName).toBe('Carol')
    expect(body.lastName).toBe('Smith')
  })

  it('returns 400 when fields are missing or not strings', async () => {
    expect((await POST(makeRequest({ identifier: 'alice' }))).status).toBe(400)
    expect((await POST(makeRequest({ identifier: ['alice'], password: PASSWORD }))).status).toBe(400)
  })

  it('returns the same 401 for an unknown user, a wrong password and an OAuth-only account', async () => {
    seedUser(docClient, { userId: 'u2', username: 'oauthuser', authProvider: 'google', oauthProviders: ['google'] })
    const replies = []
    for (const [identifier, password] of [['ghost', PASSWORD], ['alice', 'wrong'], ['oauthuser@example.com', PASSWORD]]) {
      const res = await POST(makeRequest({ identifier, password }))
      replies.push([res.status, (await res.json()).error])
    }
    expect(new Set(replies.map(JSON.stringify)).size).toBe(1)
    expect(replies[0][0]).toBe(401)
    expect(replies[0][1]).toMatch(/invalid credentials/i)
  })

  it('compares against a dummy hash when the user does not exist, so timing matches', async () => {
    const spy = jest.spyOn(bcrypt, 'compare')
    await POST(makeRequest({ identifier: 'ghost', password: PASSWORD }))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][1]).toMatch(/^\$2b\$10\$/)
    spy.mockRestore()
  })

  it('logs a security event for each failed login with the ALB-appended IP, never the identifier', async () => {
    const req = (identifier) => makeRequest({ identifier, password: 'wrong' }, { 'x-forwarded-for': '198.51.100.7, 203.0.113.9' })

    expect((await POST(req('nobody'))).status).toBe(401)
    expect((await POST(req('alice'))).status).toBe(401)
    expect(logSecurityEvent.mock.calls).toEqual([
      ['login_failed', { ip: '203.0.113.9' }],
      ['login_failed', { ip: '203.0.113.9' }],
    ])
  })

  it('keys the rate limit on the rightmost X-Forwarded-For entry', async () => {
    await POST(makeRequest({ identifier: 'alice', password: PASSWORD }, { 'x-forwarded-for': 'spoofed-1, 203.0.113.9' }))
    await POST(makeRequest({ identifier: 'alice', password: PASSWORD }, { 'x-forwarded-for': 'spoofed-2, 203.0.113.9' }))
    expect(checkRateLimit.mock.calls.map((c) => c[0])).toEqual(['login:203.0.113.9', 'login:203.0.113.9'])
  })

  it('returns 403 when user is not verified', async () => {
    seedUser(docClient, { userId: 'u4', username: 'dave', password: HASH, isVerified: false })
    const res = await POST(makeRequest({ identifier: 'dave', password: PASSWORD }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/verify your email/i)
  })

  it('does not treat a username that looks like an email as that email (C1)', async () => {
    // Legacy squatter: username "ceo@corp.com" with the squatter's password.
    docClient.put(USERS_TABLE, {
      PK: 'USER#USERNAME#ceo@corp.com', userId: 'evil', username: 'ceo@corp.com',
      email: 'evil@example.com', EmailOrUsername: 'ceo@corp.com', password: HASH, isVerified: true,
    })
    const res = await POST(makeRequest({ identifier: 'ceo@corp.com', password: PASSWORD }))
    expect(res.status).toBe(401)
  })

  it('returns 500 on unexpected error', async () => {
    docClient.beforeSend = () => { throw new Error('DB error') }
    const res = await POST(makeRequest({ identifier: 'alice', password: PASSWORD }))
    expect(res.status).toBe(500)
  })

  it('returns 429 when rate limit is exceeded', async () => {
    checkRateLimit.mockReturnValueOnce({ allowed: false, resetMs: Date.now() + 60000 })
    const res = await POST(makeRequest({ identifier: 'alice', password: PASSWORD }))
    expect(res.status).toBe(429)
    expect((await res.json()).error).toMatch(/too many/i)
  })
})
