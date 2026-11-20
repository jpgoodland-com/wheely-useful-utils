process.env.OAUTH_GOOGLE_CLIENT_ID = 'google-test-cid'
process.env.OAUTH_GOOGLE_CLIENT_SECRET = 'google-test-cs'
process.env.OAUTH_MOCK = 'true'

jest.mock('@/lib/dynamodb', () => {
  const { createFakeDynamo } = require('@/__tests__/helpers/fakeDynamo')
  return { docClient: createFakeDynamo(), TableNames: { Users: 'WheelApp_Users' } }
})

jest.mock('next/headers', () => ({
  cookies: jest.fn(() => Promise.resolve({ get: (name) => (name === 'oauth_state' ? { value: 'valid-state' } : undefined) })),
}))

const { GET } = require('@/app/api/auth/callback/[provider]/route')
const { docClient } = require('@/lib/dynamodb')
const { USERS_TABLE } = require('@/__tests__/helpers/users')

function makeCallbackRequest(provider, code) {
  const params = new URLSearchParams({ code, state: 'valid-state' })
  return new Request(`http://localhost/api/auth/callback/${provider}?${params}`, { headers: { host: 'localhost:3000' } })
}

const primary = () => docClient.items(USERS_TABLE).find((i) => i.PK.startsWith('USER#') && !i.PK.startsWith('USER#USERNAME#'))

describe('GET /api/auth/callback/[provider] in mock mode', () => {
  beforeEach(() => {
    docClient.reset()
    delete process.env.ADMIN_EMAILS
  })

  it('exchanges mock code and logs in developer@example.com', async () => {
    // developer@example.com base64 is ZGV2ZWxvcGVyQGV4YW1wbGUuY29t
    const res = await GET(makeCallbackRequest('google', 'mock-code-google-ZGV2ZWxvcGVyQGV4YW1wbGUuY29t'), { params: Promise.resolve({ provider: 'google' }) })

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/dashboard')
    expect(primary()).toMatchObject({
      email: 'developer@example.com', username: 'developer', isVerified: true,
      isAdmin: false, authProvider: 'google', oauthProviders: ['google'],
    })
    expect(res.headers.get('set-cookie')).toMatch(/(^|, )session=[^;]+/)
  })

  it('makes admin@example.com an admin only when it is on ADMIN_EMAILS', async () => {
    // admin@example.com base64 is YWRtaW5AZXhhbXBsZS5jb20=
    const code = 'mock-code-google-YWRtaW5AZXhhbXBsZS5jb20='
    await GET(makeCallbackRequest('google', code), { params: Promise.resolve({ provider: 'google' }) })
    expect(primary().isAdmin).toBe(false)

    docClient.reset()
    process.env.ADMIN_EMAILS = 'admin@example.com'
    await GET(makeCallbackRequest('google', code), { params: Promise.resolve({ provider: 'google' }) })
    expect(primary().isAdmin).toBe(true)
  })
})
