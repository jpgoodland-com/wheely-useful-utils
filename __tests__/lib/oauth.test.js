import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import {
  SUPPORTED_PROVIDERS,
  getProviderConfig,
  getClientCredentials,
  getAuthUrl,
  getBaseUrl,
  exchangeCode,
  fetchUserProfile,
  createFlowSecrets,
  pkceChallenge,
} from '@/lib/oauth'

const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs'
const MS_JWKS = 'https://login.microsoftonline.com/common/discovery/v2.0/keys'
const MS_TENANT = '11111111-2222-3333-4444-555555555555'
const MSA_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad'
const NONCE = 'nonce-abc'

let signingKey
let attackerKey
let jwks

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  signingKey = pair.privateKey
  attackerKey = (await generateKeyPair('RS256')).privateKey
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] }
})

function idToken(claims, { key = signingKey, alg = 'RS256', kid = 'k1' } = {}) {
  return new SignJWT({ nonce: NONCE, ...claims })
    .setProtectedHeader({ alg, kid })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key)
}

const googleClaims = (extra = {}) => ({
  iss: 'https://accounts.google.com', aud: 'google-cid', sub: 'g-123',
  email: 'alice@example.com', email_verified: true, name: 'Alice A', ...extra,
})
const msClaims = (extra = {}) => ({
  iss: `https://login.microsoftonline.com/${MS_TENANT}/v2.0`, aud: 'ms-cid', tid: MS_TENANT,
  oid: 'oid-1', sub: 'ms-sub', email: 'bob@corp.com', name: 'Bob B', ...extra,
})

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('lib/oauth', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      OAUTH_MOCK: undefined,
      OAUTH_GOOGLE_CLIENT_ID: 'google-cid',
      OAUTH_GOOGLE_CLIENT_SECRET: 'google-cs',
      OAUTH_MICROSOFT_CLIENT_ID: 'ms-cid',
      OAUTH_MICROSOFT_CLIENT_SECRET: 'ms-cs',
      OAUTH_GITHUB_CLIENT_ID: 'gh-cid',
      OAUTH_GITHUB_CLIENT_SECRET: 'gh-cs',
    }
    global.fetch = jest.fn(async (url) => {
      if (url === GOOGLE_JWKS || url === MS_JWKS || String(url) === GOOGLE_JWKS || String(url) === MS_JWKS) return jsonResponse(jwks)
      throw new Error(`unexpected fetch ${url}`)
    })
  })

  afterEach(() => {
    process.env = originalEnv
  })

  // ── providers and credentials ─────────────────────────────────────────────

  it('exports the three supported providers', () => {
    expect(SUPPORTED_PROVIDERS).toEqual(expect.arrayContaining(['google', 'microsoft', 'github']))
    expect(SUPPORTED_PROVIDERS).toHaveLength(3)
  })

  it('returns config for valid providers and null otherwise', () => {
    for (const p of SUPPORTED_PROVIDERS) {
      const cfg = getProviderConfig(p)
      expect(cfg.authorizeUrl).toBeDefined()
      expect(cfg.tokenUrl).toBeDefined()
    }
    expect(getProviderConfig('discord')).toBeNull()
  })

  it('reads client credentials from env vars', () => {
    expect(getClientCredentials('google')).toEqual({ clientId: 'google-cid', clientSecret: 'google-cs' })
    expect(() => getClientCredentials('discord')).toThrow(/unsupported/i)
  })

  // ── flow secrets and auth URL ─────────────────────────────────────────────

  it('creates distinct high-entropy flow secrets', () => {
    const a = createFlowSecrets()
    const b = createFlowSecrets()
    expect(a.state).not.toBe(b.state)
    expect(a.verifier.length).toBeGreaterThanOrEqual(43) // RFC 7636 minimum
    expect(pkceChallenge(a.verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it.each(['google', 'microsoft'])('sends nonce and an S256 PKCE challenge to %s', (provider) => {
    const flow = createFlowSecrets()
    const url = new URL(getAuthUrl(provider, flow, 'http://localhost/callback'))
    expect(url.searchParams.get('state')).toBe(flow.state)
    expect(url.searchParams.get('nonce')).toBe(flow.nonce)
    expect(url.searchParams.get('code_challenge')).toBe(pkceChallenge(flow.verifier))
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost/callback')
    expect(url.searchParams.get('response_type')).toBe('code')
  })

  it('builds a plain OAuth URL for GitHub', () => {
    const url = new URL(getAuthUrl('github', createFlowSecrets(), 'http://x/cb'))
    expect(url.searchParams.get('client_id')).toBe('gh-cid')
    expect(url.searchParams.get('code_challenge')).toBeNull()
  })

  it('includes prompt=consent for Google and throws for unknown providers', () => {
    expect(new URL(getAuthUrl('google', createFlowSecrets(), 'http://x')).searchParams.get('prompt')).toBe('consent')
    expect(() => getAuthUrl('discord', createFlowSecrets(), 'http://x')).toThrow(/unsupported/i)
  })

  // ── exchangeCode ──────────────────────────────────────────────────────────

  it('sends the code and PKCE verifier and returns the tokens', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ access_token: 'tok123', id_token: 'idt' }))
    const tokens = await exchangeCode('google', 'authcode', 'http://localhost/cb', 'verifier-1')
    expect(tokens).toEqual({ access_token: 'tok123', id_token: 'idt' })

    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('googleapis.com')
    const body = new URLSearchParams(opts.body)
    expect(body.get('code')).toBe('authcode')
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code_verifier')).toBe('verifier-1')
  })

  it('refuses an OIDC exchange without a PKCE verifier', async () => {
    await expect(exchangeCode('microsoft', 'c', 'http://x')).rejects.toThrow(/PKCE/)
  })

  it('throws on non-OK response without echoing the body', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('secret-ish details', { status: 400 }))
    const err = await exchangeCode('google', 'bad', 'http://x', 'v').catch((e) => e)
    expect(err.message).toMatch(/token exchange failed/i)
    expect(err.message).not.toMatch(/secret-ish/)
  })

  it('sets Accept: application/json for GitHub', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ access_token: 'tok' }))
    await exchangeCode('github', 'code', 'http://x')
    expect(global.fetch.mock.calls[0][1].headers.Accept).toBe('application/json')
  })

  // ── Google ID tokens ──────────────────────────────────────────────────────

  describe('Google', () => {
    const profile = async (claims, opts, nonce = NONCE) =>
      fetchUserProfile('google', { access_token: 'a', id_token: await idToken(claims, opts) }, { nonce })

    it('returns a verified identity from a valid ID token', async () => {
      expect(await profile(googleClaims())).toEqual({ email: 'alice@example.com', name: 'Alice A', emailVerified: true, subject: 'g-123' })
    })

    it('marks the email unverified when email_verified is false (C2)', async () => {
      expect((await profile(googleClaims({ email_verified: false }))).emailVerified).toBe(false)
    })

    it.each([
      ['a wrong audience', googleClaims({ aud: 'someone-else' })],
      ['a wrong issuer', googleClaims({ iss: 'https://evil.example' })],
      ['an azp for another client', googleClaims({ azp: 'other-client' })],
    ])('rejects %s', async (_label, claims) => {
      await expect(profile(claims)).rejects.toThrow()
    })

    it('rejects a token signed by another key', async () => {
      await expect(profile(googleClaims(), { key: attackerKey })).rejects.toThrow()
    })

    it('rejects a nonce mismatch or a missing expected nonce', async () => {
      await expect(profile(googleClaims(), undefined, 'other-nonce')).rejects.toThrow(/nonce/)
      await expect(profile(googleClaims(), undefined, null)).rejects.toThrow(/nonce/)
    })

    it('rejects an unsigned (alg: none) token', async () => {
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
      const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...googleClaims(), nonce: NONCE, exp: Math.floor(Date.now() / 1000) + 300 })}.`
      await expect(fetchUserProfile('google', { access_token: 'a', id_token: none }, { nonce: NONCE })).rejects.toThrow()
    })

    it('rejects an HS256 token signed with the client secret', async () => {
      const hs = await new SignJWT({ ...googleClaims(), nonce: NONCE })
        .setProtectedHeader({ alg: 'HS256', kid: 'k1' }).setExpirationTime('5m')
        .sign(new TextEncoder().encode('google-cs'))
      await expect(fetchUserProfile('google', { access_token: 'a', id_token: hs }, { nonce: NONCE })).rejects.toThrow()
    })

    it('rejects a response without an ID token', async () => {
      await expect(fetchUserProfile('google', { access_token: 'a' }, { nonce: NONCE })).rejects.toThrow(/no ID token/)
    })
  })

  // ── Microsoft ID tokens ───────────────────────────────────────────────────

  describe('Microsoft', () => {
    const profile = async (claims) =>
      fetchUserProfile('microsoft', { access_token: 'a', id_token: await idToken(claims) }, { nonce: NONCE })

    it('trusts the email only with xms_edov (nOAuth, C2)', async () => {
      expect((await profile(msClaims())).emailVerified).toBe(false)
      expect((await profile(msClaims({ xms_edov: true }))).emailVerified).toBe(true)
    })

    it('trusts personal Microsoft account emails', async () => {
      const claims = msClaims({ tid: MSA_TENANT, iss: `https://login.microsoftonline.com/${MSA_TENANT}/v2.0` })
      expect((await profile(claims)).emailVerified).toBe(true)
    })

    it('rejects a token whose issuer does not match its tenant', async () => {
      await expect(profile(msClaims({ iss: 'https://login.microsoftonline.com/other-tenant/v2.0', xms_edov: true }))).rejects.toThrow(/issuer/)
    })

    it('uses tenant + object id as the stable subject', async () => {
      expect((await profile(msClaims({ xms_edov: true }))).subject).toBe(`${MS_TENANT}:oid-1`)
    })
  })

  // ── GitHub ────────────────────────────────────────────────────────────────

  describe('GitHub', () => {
    function github(user, emails) {
      global.fetch = jest.fn(async (url) => (String(url).endsWith('/user') ? jsonResponse(user) : jsonResponse(emails)))
      return fetchUserProfile('github', { access_token: 'gh' })
    }

    it('uses the primary verified email, never the public profile email', async () => {
      const p = await github({ id: 7, login: 'octo', email: 'public@unverified.com' }, [
        { email: 'other@x.com', primary: false, verified: true },
        { email: 'me@x.com', primary: true, verified: true },
      ])
      expect(p).toEqual({ email: 'me@x.com', name: 'octo', emailVerified: true, subject: '7' })
    })

    it('returns no email when the primary address is unverified (C2)', async () => {
      const p = await github({ id: 7, login: 'octo' }, [
        { email: 'me@x.com', primary: true, verified: false },
        { email: 'other@x.com', primary: false, verified: true },
      ])
      expect(p.email).toBe('')
      expect(p.emailVerified).toBe(false)
    })

    it('throws on non-OK userinfo response', async () => {
      global.fetch = jest.fn().mockResolvedValue(new Response('', { status: 401 }))
      await expect(fetchUserProfile('github', { access_token: 'bad' })).rejects.toThrow(/userinfo fetch failed/i)
    })
  })

  // ── getBaseUrl ────────────────────────────────────────────────────────────

  describe('getBaseUrl', () => {
    it('uses x-forwarded-proto and host from request headers', () => {
      const req = new Request('http://localhost:3000/api/auth/oauth/google', {
        headers: {
          'x-forwarded-proto': 'https',
          host: 'wheel-app.example.com',
        },
      })
      expect(getBaseUrl(req)).toBe('https://wheel-app.example.com')
    })

    it('prefers x-forwarded-host when present', () => {
      const req = new Request('http://localhost:3000/api/auth/oauth/google', {
        headers: {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'wheel-app.example.com',
          host: 'internal-alb.aws.local',
        },
      })
      expect(getBaseUrl(req)).toBe('https://wheel-app.example.com')
    })

    it('defaults to https in production when x-forwarded-proto is absent', () => {
      process.env.NODE_ENV = 'production'
      const req = new Request('http://localhost:3000/api/auth/oauth/google', {
        headers: { host: 'wheel-app.example.com' },
      })
      expect(getBaseUrl(req)).toBe('https://wheel-app.example.com')
    })

    it('defaults to https when FORCE_HTTPS is true', () => {
      process.env.FORCE_HTTPS = 'true'
      const req = new Request('http://localhost:3000/api/auth/oauth/google', {
        headers: { host: 'wheel-app.example.com' },
      })
      expect(getBaseUrl(req)).toBe('https://wheel-app.example.com')
    })

    it('falls back to APP_DOMAIN when host header is missing', () => {
      process.env.APP_DOMAIN = 'wheel-app.example.com'
      expect(getBaseUrl({})).toBe('http://wheel-app.example.com')
    })

    it('defaults to http://localhost:3000 when no headers or env vars exist', () => {
      expect(getBaseUrl({})).toBe('http://localhost:3000')
    })
  })
})
