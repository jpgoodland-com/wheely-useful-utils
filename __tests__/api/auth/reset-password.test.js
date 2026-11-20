jest.mock('@/lib/dynamodb', () => {
  const { createFakeDynamo } = require('@/__tests__/helpers/fakeDynamo')
  return { docClient: createFakeDynamo(), TableNames: { Users: 'WheelApp_Users' } }
})
jest.mock('@/lib/rateLimit', () => ({
  checkRateLimit: jest.fn().mockReturnValue({ allowed: true, resetMs: Date.now() + 1000 }),
}))
jest.mock('@/lib/users/passwordHash', () => ({ hashPassword: jest.fn(async (pw) => `hashed:${pw}`) }))

const { POST } = require('@/app/api/auth/reset-password/route')
const { docClient } = require('@/lib/dynamodb')
const { checkRateLimit } = require('@/lib/rateLimit')
const { newToken } = require('@/lib/tokens')
const { seedUser, getUser, getPointer } = require('@/__tests__/helpers/users')

const NEW_PW = 'N3w!Password#2025'

function makeRequest(body) {
  return new Request('http://localhost/api/auth/reset-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

let token
beforeEach(() => {
  docClient.reset()
  checkRateLimit.mockReturnValue({ allowed: true, resetMs: Date.now() + 1000 })
  const t = newToken()
  token = t.token
  seedUser(docClient, {
    userId: 'u1', username: 'alice', password: 'old-hash',
    passwordResetTokenHash: t.hash,
    passwordResetExpiry: new Date(Date.now() + 3600_000).toISOString(),
  })
})

describe('POST /api/auth/reset-password', () => {
  it('updates the password on both items and removes the token', async () => {
    const res = await POST(makeRequest({ userId: 'u1', token, newPassword: NEW_PW }))
    expect(res.status).toBe(200)
    for (const item of [getUser(docClient, 'u1'), getPointer(docClient, 'alice')]) {
      expect(item.password).toBe(`hashed:${NEW_PW}`)
      expect(item.passwordResetTokenHash).toBeUndefined()
      expect(item.passwordResetExpiry).toBeUndefined()
      expect(item.passwordChangedAt).toBeDefined()
    }
  })

  it('is single use', async () => {
    expect((await POST(makeRequest({ userId: 'u1', token, newPassword: NEW_PW }))).status).toBe(200)
    expect((await POST(makeRequest({ userId: 'u1', token, newPassword: 'An0ther!Password#' }))).status).toBe(400)
    expect(getUser(docClient, 'u1').password).toBe(`hashed:${NEW_PW}`)
  })

  it('lets only one of two concurrent requests use the token', async () => {
    // The second request reads the user before the first one writes.
    let held = false
    docClient.beforeSend = async (name, input, client) => {
      if (name === 'UpdateCommand' && input.Key.PK === 'USER#u1' && !held) {
        held = true
        client.put('WheelApp_Users', { ...client.get('WheelApp_Users', 'USER#u1'), passwordResetTokenHash: 'rotated' })
      }
    }
    const res = await POST(makeRequest({ userId: 'u1', token, newPassword: NEW_PW }))
    expect(res.status).toBe(400)
    expect(getUser(docClient, 'u1').password).toBe('old-hash')
  })

  it('gives the same reply for a wrong token, an unknown user, no pending reset and an expired link', async () => {
    seedUser(docClient, { userId: 'u2', username: 'bob' })
    seedUser(docClient, { userId: 'u3', username: 'carol', passwordResetTokenHash: newToken().hash, passwordResetExpiry: new Date(Date.now() - 1).toISOString() })
    const replies = []
    for (const body of [
      { userId: 'u1', token: 'wrong' },
      { userId: 'ghost', token },
      { userId: 'u2', token },
      { userId: 'u3', token },
    ]) {
      const res = await POST(makeRequest({ ...body, newPassword: NEW_PW }))
      replies.push([res.status, await res.json()])
    }
    expect(new Set(replies.map(JSON.stringify)).size).toBe(1)
    expect(replies[0][0]).toBe(400)
  })

  it('fails if password does not meet requirements', async () => {
    const res = await POST(makeRequest({ userId: 'u1', token, newPassword: 'weak' }))
    expect(res.status).toBe(400)
  })

  it('fails if rate limit is exceeded', async () => {
    checkRateLimit.mockReturnValueOnce({ allowed: false, resetMs: Date.now() + 1000 })
    const res = await POST(makeRequest({ userId: 'u1', token, newPassword: NEW_PW }))
    expect(res.status).toBe(429)
  })

  it('fails if required fields are missing', async () => {
    const res = await POST(makeRequest({ userId: 'u1' }))
    expect(res.status).toBe(400)
  })

  it('fails if database throws an error', async () => {
    docClient.beforeSend = () => { throw new Error('DB') }
    const res = await POST(makeRequest({ userId: 'u1', token, newPassword: NEW_PW }))
    expect(res.status).toBe(500)
  })
})
