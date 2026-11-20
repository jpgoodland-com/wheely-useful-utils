process.env.OAUTH_GOOGLE_CLIENT_ID = 'google-test-cid'
process.env.OAUTH_GOOGLE_CLIENT_SECRET = 'google-test-cs'

jest.mock('@/lib/dynamodb', () => {
  const { createFakeDynamo } = require('@/__tests__/helpers/fakeDynamo')
  return { docClient: createFakeDynamo(), TableNames: { Users: 'WheelApp_Users' } }
})

// Mock the OAuth helpers so we don't make real HTTP requests
jest.mock('@/lib/oauth', () => ({
  ...jest.requireActual('@/lib/oauth'),
  exchangeCode: jest.fn(),
  fetchUserProfile: jest.fn(),
}))

// Mock next/headers cookies(): one value per cookie name
let cookieJar = {}
jest.mock('next/headers', () => ({
  cookies: jest.fn(() => Promise.resolve({ get: (name) => (name in cookieJar ? { value: cookieJar[name] } : undefined) })),
}))

const { GET } = require('@/app/api/auth/callback/[provider]/route')
const { docClient } = require('@/lib/dynamodb')
const { exchangeCode, fetchUserProfile } = require('@/lib/oauth')
const { seedUser, getUser, getPointer, USERS_TABLE } = require('@/__tests__/helpers/users')

function makeCallbackRequest(provider, { code = 'test-code', state = 'valid-state', error: errorParam, headers } = {}) {
  const params = new URLSearchParams()
  if (code) params.set('code', code)
  if (state) params.set('state', state)
  if (errorParam) params.set('error', errorParam)

  return new Request(`http://localhost/api/auth/callback/${provider}?${params}`, {
    method: 'GET',
    headers: headers || { host: 'localhost:3000' },
  })
}

const call = (provider = 'google', opts) => GET(makeCallbackRequest(provider, opts), { params: Promise.resolve({ provider }) })
const location = (res) => res.headers.get('location')
const primaries = () => docClient.items(USERS_TABLE).filter((i) => i.PK.startsWith('USER#') && !i.PK.startsWith('USER#USERNAME#'))

beforeEach(() => {
  jest.clearAllMocks()
  docClient.reset()
  delete process.env.ADMIN_EMAILS
  cookieJar = { oauth_state: 'valid-state', oauth_nonce: 'n-1', oauth_verifier: 'v-1' }
  exchangeCode.mockResolvedValue({ access_token: 'at', id_token: 'it' })
  fetchUserProfile.mockResolvedValue({ email: 'test@example.com', name: 'Test User', emailVerified: true, subject: 's1' })
})

describe('GET /api/auth/callback/[provider]', () => {
  it('redirects to /login with error for unsupported provider', async () => {
    const res = await call('discord')
    expect(res.status).toBe(307)
    expect(location(res)).toContain('/login?error=unsupported_provider')
  })

  it('redirects to /login when provider returns an error', async () => {
    expect(location(await call('google', { error: 'access_denied' }))).toContain('/login?error=access_denied')
  })

  it('redirects to /login when code is missing', async () => {
    expect(location(await call('google', { code: null }))).toContain('/login?error=missing_params')
  })

  it('rejects mismatched or missing CSRF state', async () => {
    cookieJar.oauth_state = 'different-state'
    expect(location(await call())).toContain('/login?error=invalid_state')
    delete cookieJar.oauth_state
    expect(location(await call())).toContain('/login?error=invalid_state')
    expect(exchangeCode).not.toHaveBeenCalled()
  })

  it('passes the PKCE verifier and nonce from the flow cookies', async () => {
    await call()
    expect(exchangeCode).toHaveBeenCalledWith('google', 'test-code', 'http://localhost:3000/api/auth/callback/google', 'v-1')
    expect(fetchUserProfile).toHaveBeenCalledWith('google', { access_token: 'at', id_token: 'it' }, { nonce: 'n-1' })
  })

  it('creates a new verified user when the email does not exist', async () => {
    const res = await call()
    expect(location(res)).toContain('/dashboard')
    const [user] = primaries()
    expect(user).toMatchObject({ email: 'test@example.com', isVerified: true, authProvider: 'google', oauthProviders: ['google'] })
    expect(user.password).toBeUndefined()
    expect(getPointer(docClient, user.username)).toMatchObject({ userId: user.userId })
  })

  it('refuses an email the provider has not verified, creating nothing (C2)', async () => {
    fetchUserProfile.mockResolvedValue({ email: 'victim@corp.com', name: 'X', emailVerified: false })
    const res = await call()
    expect(location(res)).toContain('/login?error=email_unverified')
    expect(primaries()).toHaveLength(0)
    expect(res.headers.get('set-cookie')).not.toMatch(/(^|, )session=[^;]/)
  })

  it('refuses to sign in to an existing account with an unverified provider email (C2)', async () => {
    seedUser(docClient, { userId: 'victim', username: 'victim', email: 'victim@corp.com', password: 'h' })
    fetchUserProfile.mockResolvedValue({ email: 'victim@corp.com', name: 'X', emailVerified: false })
    const res = await call('microsoft')
    expect(location(res)).toContain('/login?error=email_unverified')
    expect(getUser(docClient, 'victim').oauthProviders).toBeUndefined()
  })

  it('links the provider to an existing verified user, keeping their password', async () => {
    seedUser(docClient, { userId: 'existing-id', username: 'testuser', email: 'test@example.com', password: 'h' })
    const res = await call()
    expect(location(res)).toContain('/dashboard')
    for (const item of [getUser(docClient, 'existing-id'), getPointer(docClient, 'testuser')]) {
      expect(item.oauthProviders).toEqual(['google'])
      expect(item.password).toBe('h')
    }
  })

  it('does not duplicate provider when already linked', async () => {
    seedUser(docClient, { userId: 'existing-id', username: 'testuser', email: 'test@example.com', oauthProviders: ['google'] })
    await call()
    expect(getUser(docClient, 'existing-id').oauthProviders).toEqual(['google'])
    expect(docClient.calls.filter((c) => c.name === 'UpdateCommand')).toHaveLength(0)
  })

  it('wipes the password of an unverified account before linking it (C5 pre-account hijack)', async () => {
    seedUser(docClient, {
      userId: 'squat', username: 'squatter', email: 'test@example.com', isVerified: false,
      password: 'attacker-hash', verificationTokenHash: 'h', verificationTokenExpiry: 'x', expiresAt: 123,
    })
    const res = await call()
    expect(location(res)).toContain('/dashboard')
    for (const item of [getUser(docClient, 'squat'), getPointer(docClient, 'squatter')]) {
      expect(item.password).toBeUndefined()
      expect(item.isVerified).toBe(true)
      expect(item.verificationTokenHash).toBeUndefined()
      expect(item.expiresAt).toBeUndefined()
    }
  })

  it('never signs in to an account whose username equals the email (C1 squat)', async () => {
    docClient.put(USERS_TABLE, {
      PK: 'USER#USERNAME#test@example.com', userId: 'evil', username: 'test@example.com',
      email: 'evil@example.com', EmailOrUsername: 'test@example.com', isVerified: true,
    })
    const res = await call()
    expect(location(res)).toContain('/login?error=account_conflict')
    expect(res.headers.get('set-cookie')).not.toMatch(/(^|, )session=[^;]/)
  })

  it('sets the session cookie on success with SameSite=Lax and clears the flow cookies', async () => {
    const setCookie = (await call()).headers.get('set-cookie')
    expect(setCookie).toMatch(/(^|, )session=[^;]+/)
    expect(setCookie.toLowerCase()).toContain('samesite=lax')
    for (const name of ['oauth_state', 'oauth_nonce', 'oauth_verifier']) expect(setCookie).toMatch(new RegExp(`${name}=;`))
  })

  it('redirects to HTTPS dashboard behind reverse proxy', async () => {
    const res = await call('google', { headers: { host: 'wheel-app.example.com', 'x-forwarded-proto': 'https' } })
    expect(location(res)).toBe('https://wheel-app.example.com/dashboard')
  })

  it('redirects to /login on exchangeCode failure without logging the error object', async () => {
    exchangeCode.mockRejectedValue(new Error('token exchange failed'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(location(await call())).toContain('/login?error=oauth_failed')
    expect(spy.mock.calls[0][1]).toBe('token exchange failed')
    spy.mockRestore()
  })

  it('redirects to /login when profile has no email', async () => {
    fetchUserProfile.mockResolvedValue({ email: '', name: 'No Email', emailVerified: true })
    expect(location(await call())).toContain('/login?error=no_email')
  })

  it('generates a valid username from the email prefix', async () => {
    fetchUserProfile.mockResolvedValue({ email: 'Alice.Smith+tag@gmail.com', name: 'Alice', emailVerified: true })
    await call()
    expect(primaries()[0].username).toBe('alice.smithtag')
  })

  it('adds a suffix when the derived username is taken, and pads short prefixes', async () => {
    seedUser(docClient, { userId: 'u0', username: 'alice', email: 'other@example.com' })
    fetchUserProfile.mockResolvedValue({ email: 'alice@gmail.com', name: 'Alice', emailVerified: true })
    await call()
    const created = primaries().find((u) => u.email === 'alice@gmail.com')
    expect(created.username).toMatch(/^alice_[0-9a-f]{6}$/)

    fetchUserProfile.mockResolvedValue({ email: 'x@gmail.com', name: 'X', emailVerified: true })
    await call()
    expect(primaries().find((u) => u.email === 'x@gmail.com').username).toBe('userx')
  })

  it('grants admin only from the ADMIN_EMAILS allowlist (C3)', async () => {
    fetchUserProfile.mockResolvedValue({ email: 'admin@example.com', name: 'Admin', emailVerified: true })
    await call()
    expect(primaries()[0].isAdmin).toBe(false)

    docClient.reset()
    process.env.ADMIN_EMAILS = 'admin@example.com'
    await call()
    expect(primaries()[0].isAdmin).toBe(true)
  })
})
