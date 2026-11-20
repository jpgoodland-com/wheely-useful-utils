jest.mock('@/lib/dynamodb', () => {
  const { createFakeDynamo } = require('@/__tests__/helpers/fakeDynamo')
  return { docClient: createFakeDynamo(), TableNames: { Users: 'WheelApp_Users' } }
})

const { POST } = require('@/app/api/auth/verify/route')
const { docClient } = require('@/lib/dynamodb')
const { newToken } = require('@/lib/tokens')
const { seedUser, getUser, getPointer } = require('@/__tests__/helpers/users')

function makeRequest(body) {
  return new Request('http://localhost/api/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

let token
beforeEach(() => {
  docClient.reset()
  const t = newToken()
  token = t.token
  seedUser(docClient, {
    userId: 'u1', username: 'alice', isVerified: false,
    verificationTokenHash: t.hash,
    verificationTokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  })
})

describe('POST /api/auth/verify', () => {
  it('verifies the user and clears the token, expiry and TTL on both items', async () => {
    const res = await POST(makeRequest({ userId: 'u1', token }))
    expect(res.status).toBe(200)
    for (const item of [getUser(docClient, 'u1'), getPointer(docClient, 'alice')]) {
      expect(item.isVerified).toBe(true)
      expect(item.emailVerifiedAt).toBeDefined()
      expect(item.verificationTokenHash).toBeUndefined()
      expect(item.verificationTokenExpiry).toBeUndefined()
      expect(item.expiresAt).toBeUndefined()
    }
  })

  it('returns 400 when userId or token is missing', async () => {
    expect((await POST(makeRequest({ userId: 'u1' }))).status).toBe(400)
    expect((await POST(makeRequest({ userId: 'u1', token: 123 }))).status).toBe(400)
  })

  it('gives the same reply for an unknown user, a used link and a wrong token', async () => {
    const replies = []
    for (const body of [{ userId: 'ghost', token }, { userId: 'u1', token: 'wrong' }]) {
      const res = await POST(makeRequest(body))
      replies.push([res.status, await res.json()])
    }
    await POST(makeRequest({ userId: 'u1', token }))
    const used = await POST(makeRequest({ userId: 'u1', token }))
    replies.push([used.status, await used.json()])
    expect(new Set(replies.map(JSON.stringify)).size).toBe(1)
    expect(replies[0][0]).toBe(400)
  })

  it('rejects an expired link', async () => {
    seedUser(docClient, { userId: 'u2', username: 'bob', isVerified: false, verificationTokenHash: newToken().hash, verificationTokenExpiry: new Date(Date.now() - 1000).toISOString() })
    const res = await POST(makeRequest({ userId: 'u2', token }))
    expect(res.status).toBe(400)
  })

  it('does not crash when the account has no stored token', async () => {
    seedUser(docClient, { userId: 'u3', username: 'carol', isVerified: false, verificationTokenExpiry: new Date(Date.now() + 1000).toISOString() })
    const res = await POST(makeRequest({ userId: 'u3', token }))
    expect(res.status).toBe(400)
  })

  it('returns 500 on unexpected error', async () => {
    docClient.beforeSend = () => { throw new Error('DB') }
    const res = await POST(makeRequest({ userId: 'u1', token }))
    expect(res.status).toBe(500)
  })
})
