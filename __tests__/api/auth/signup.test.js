jest.mock('@/lib/dynamodb', () => {
  const { createFakeDynamo } = require('@/__tests__/helpers/fakeDynamo')
  return { docClient: createFakeDynamo(), TableNames: { Users: 'WheelApp_Users' } }
})

// Mock email module to avoid real SES calls
jest.mock('@/lib/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
}))

// Mock rate limiting
jest.mock('@/lib/rateLimit', () => ({
  checkRateLimit: jest.fn().mockReturnValue({ allowed: true, resetMs: Date.now() + 1000 })
}))

// Cost-12 bcrypt is slow; the cost itself is checked in passwordHash tests.
jest.mock('@/lib/users/passwordHash', () => ({ hashPassword: jest.fn(async (pw) => `hashed:${pw}`) }))

const { POST } = require('@/app/api/auth/signup/route')
const { docClient } = require('@/lib/dynamodb')
const { sendEmail } = require('@/lib/email')
const { checkRateLimit } = require('@/lib/rateLimit')
const { hashToken } = require('@/lib/tokens')
const { seedUser, getPointer, USERS_TABLE } = require('@/__tests__/helpers/users')

const VALID = {
  email: 'new@example.com',
  username: 'newuser',
  password: 'Str0ng!Passw0rd#',
  firstName: 'New',
  lastName: 'User',
}

function makeRequest(body) {
  return new Request('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  })
}

const primaryFor = (email) =>
  docClient.items(USERS_TABLE).find((i) => i.PK.startsWith('USER#') && !i.PK.startsWith('USER#USERNAME#') && i.email === email)

const GENERIC = { success: true, message: 'Please check your email to verify your account' }

beforeEach(() => {
  jest.clearAllMocks()
  docClient.reset()
  delete process.env.ADMIN_EMAILS
  checkRateLimit.mockReturnValue({ allowed: true, resetMs: Date.now() + 1000 })
})

describe('POST /api/auth/signup', () => {
  it('creates an unverified user with a hashed verification token and a TTL', async () => {
    const res = await POST(makeRequest(VALID))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(GENERIC)

    const user = primaryFor('new@example.com')
    expect(user).toMatchObject({ username: 'newuser', isVerified: false, isAdmin: false, password: 'hashed:Str0ng!Passw0rd#' })
    expect(user.verificationToken).toBeUndefined()
    expect(user.verificationTokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(user.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000) + 6 * 24 * 3600)
    expect(getPointer(docClient, 'newuser')).toMatchObject({ userId: user.userId, EmailOrUsername: 'newuser' })

    // The emailed token is the one whose hash was stored.
    const link = sendEmail.mock.calls[0][0].text.match(/token=([0-9a-f]+)/)[1]
    expect(hashToken(link)).toBe(user.verificationTokenHash)
  })

  it('returns 400 when fields are missing', async () => {
    const res = await POST(makeRequest({ email: 'a@b.com' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when firstName or lastName is missing or empty', async () => {
    expect((await POST(makeRequest({ ...VALID, firstName: '   ' }))).status).toBe(400)
    expect((await POST(makeRequest({ ...VALID, lastName: 'x'.repeat(51) }))).status).toBe(400)
  })

  it('returns 400 for invalid email format', async () => {
    const res = await POST(makeRequest({ ...VALID, email: 'not-an-email' }))
    expect(res.status).toBe(400)
  })

  it.each([
    ['ceo@corp.com', 'contains @'],
    ['ab', 'too short'],
    ['-dash', 'starts with punctuation'],
    ['has space', 'contains a space'],
    ['x'.repeat(33), 'too long'],
  ])('rejects username %p (%s)', async (username) => {
    const res = await POST(makeRequest({ ...VALID, username }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/username/i)
    expect(docClient.items(USERS_TABLE)).toHaveLength(0)
  })

  it('gives the same reply for a registered email and emails the owner instead (no enumeration)', async () => {
    seedUser(docClient, { userId: 'u1', username: 'alice', email: 'new@example.com', isVerified: true })
    const res = await POST(makeRequest({ ...VALID, username: 'other' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(GENERIC)
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'new@example.com', subject: expect.stringMatching(/tried to sign up/i) }))
    expect(getPointer(docClient, 'other')).toBeUndefined()
  })

  it('replaces an unverified account squatting the email, dropping the squatter password (C5)', async () => {
    seedUser(docClient, { userId: 'squat', username: 'squatter', email: 'new@example.com', isVerified: false, password: 'squatter-hash' })
    const res = await POST(makeRequest(VALID))
    expect(res.status).toBe(200)

    const user = primaryFor('new@example.com')
    expect(user.userId).not.toBe('squat')
    expect(user.password).toBe('hashed:Str0ng!Passw0rd#')
    expect(docClient.get(USERS_TABLE, 'USER#squat')).toBeUndefined()
    expect(getPointer(docClient, 'squatter')).toBeUndefined()
  })

  it('does not create a second account when a legacy @ username claims the email', async () => {
    docClient.put(USERS_TABLE, { PK: 'USER#USERNAME#new@example.com', userId: 'legacy', username: 'new@example.com', EmailOrUsername: 'new@example.com' })
    const res = await POST(makeRequest(VALID))
    expect(await res.json()).toEqual(GENERIC)
    expect(primaryFor('new@example.com')).toBeUndefined()
  })

  it('returns 409 when username already taken', async () => {
    seedUser(docClient, { userId: 'u1', username: 'newuser', email: 'someone@example.com' })
    const res = await POST(makeRequest(VALID))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/username/i)
  })

  it('returns 500 on unexpected DynamoDB error', async () => {
    docClient.beforeSend = () => { throw new Error('DB down') }
    const res = await POST(makeRequest(VALID))
    expect(res.status).toBe(500)
  })

  it('grants admin only to addresses on the ADMIN_EMAILS allowlist', async () => {
    process.env.ADMIN_EMAILS = 'boss@example.com, other@example.com'
    await POST(makeRequest({ ...VALID, email: 'Boss@Example.com', username: 'boss' }))
    expect(primaryFor('boss@example.com').isAdmin).toBe(true)
  })

  it('never grants admin by domain when ADMIN_EMAILS is unset (C3)', async () => {
    await POST(makeRequest({ ...VALID, email: 'someone@example.com', username: 'someone' }))
    expect(primaryFor('someone@example.com').isAdmin).toBe(false)
  })

  it('returns 429 when rate limit is exceeded', async () => {
    checkRateLimit.mockReturnValueOnce({ allowed: false, resetMs: Date.now() + 60000 })
    const res = await POST(makeRequest(VALID))
    expect(res.status).toBe(429)
  })
})
