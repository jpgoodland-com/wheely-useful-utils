/**
 * Tests for proxy.js — rate limiting, HTTPS enforcement, and HSTS.
 *
 * We mock lib/rateLimit so we can control allowed/blocked outcomes
 * without needing real timers or a real store.
 */

jest.mock('@/lib/rateLimit', () => ({ checkRateLimit: jest.fn() }))

const { NextRequest } = require('next/server')

let proxy
let checkRateLimit

beforeEach(async () => {
  jest.clearAllMocks()
  // Re-require so mock references are fresh
  ;({ checkRateLimit } = require('@/lib/rateLimit'))
  ;({ proxy } = await import('@/proxy'))
})

function makeRequest(pathname, { xff = '1.2.3.4', protocol = 'http' } = {}) {
  const url = `${protocol}://localhost${pathname}`
  return new NextRequest(url, {
    headers: xff ? { 'x-forwarded-for': xff } : {},
  })
}

// Helper: make checkRateLimit always allow
function allowAll() {
  checkRateLimit.mockReturnValue({ allowed: true, remaining: 99, resetMs: Date.now() + 60_000 })
}

// Helper: make the Nth call to checkRateLimit block
function blockOnCall(n) {
  let call = 0
  checkRateLimit.mockImplementation(() => {
    call++
    if (call === n) return { allowed: false, remaining: 0, resetMs: Date.now() + 30_000 }
    return { allowed: true, remaining: 99, resetMs: Date.now() + 60_000 }
  })
}

// ── HTTPS enforcement ─────────────────────────────────────────────────────────

describe('proxy - HTTPS enforcement (FORCE_HTTPS=true)', () => {
  beforeEach(async () => {
    process.env.FORCE_HTTPS = 'true'
    jest.resetModules()
    ;({ checkRateLimit } = require('@/lib/rateLimit'))
    ;({ proxy } = await import('@/proxy'))
    allowAll()
  })

  afterEach(() => {
    delete process.env.FORCE_HTTPS
  })

  it('redirects http:// to https:// with 301 when FORCE_HTTPS is set', () => {
    const res = proxy(makeRequest('/api/wheels', { protocol: 'http' }))
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toMatch(/^https:\/\//)
  })

  it('does not redirect https:// requests', () => {
    const res = proxy(makeRequest('/api/wheels', { protocol: 'https' }))
    expect(res.status).not.toBe(301)
  })

  it('sets Strict-Transport-Security header on allowed responses', () => {
    const res = proxy(makeRequest('/api/wheels', { protocol: 'https' }))
    const hsts = res.headers.get('Strict-Transport-Security')
    expect(hsts).toMatch(/max-age=/)
    expect(hsts).toMatch(/includeSubDomains/)
  })
})

describe('proxy - HTTPS enforcement (FORCE_HTTPS unset)', () => {
  it('does NOT redirect http:// when FORCE_HTTPS is not set', () => {
    allowAll()
    const res = proxy(makeRequest('/api/wheels', { protocol: 'http' }))
    expect(res.status).not.toBe(301)
  })

  it('does NOT set HSTS header when FORCE_HTTPS is not set', () => {
    allowAll()
    const res = proxy(makeRequest('/api/wheels', { protocol: 'http' }))
    expect(res.headers.get('Strict-Transport-Security')).toBeNull()
  })
})

// ── Rate limiting ─────────────────────────────────────────────────────────────

describe('proxy - happy path', () => {
  it('passes through when all limits are satisfied', () => {
    allowAll()
    const res = proxy(makeRequest('/api/wheels'))
    expect(res.status).not.toBe(429)
  })

  it('passes through for non-API paths', () => {
    allowAll()
    const res = proxy(makeRequest('/dashboard'))
    expect(res.status).not.toBe(429)
  })
})

describe('proxy - global rate limit', () => {
  it('returns 429 when global limit is exceeded', () => {
    blockOnCall(1)
    const res = proxy(makeRequest('/api/wheels'))
    expect(res.status).toBe(429)
  })

  it('includes Retry-After header', () => {
    blockOnCall(1)
    const res = proxy(makeRequest('/api/wheels'))
    expect(res.headers.get('Retry-After')).toBeTruthy()
  })
})

describe('proxy - per-route tiers', () => {
  it('applies auth-mutate tier to /api/auth/login', () => {
    allowAll()
    proxy(makeRequest('/api/auth/login'))
    const calls = checkRateLimit.mock.calls
    expect(calls.some(([key]) => key.startsWith('auth-mutate:'))).toBe(true)
  })

  it('applies auth-mutate tier to /api/auth/signup', () => {
    allowAll()
    proxy(makeRequest('/api/auth/signup'))
    const calls = checkRateLimit.mock.calls
    expect(calls.some(([key]) => key.startsWith('auth-mutate:'))).toBe(true)
  })

  it('applies spin tier to /api/wheels/:id/spin', () => {
    allowAll()
    proxy(makeRequest('/api/wheels/abc-123/spin'))
    const calls = checkRateLimit.mock.calls
    expect(calls.some(([key]) => key.startsWith('spin:'))).toBe(true)
  })

  it.each([
    ['/api/capacity-plans/p1/members', 'capacity-share:'],
    ['/api/capacity-plans/p1/members/u2', 'capacity-share:'],
    ['/api/capacity-plans/p1/access', 'capacity-share:'],
    ['/api/capacity-plans/p1/access/u2', 'capacity-share:'],
    ['/api/capacity-plans/p1/export', 'capacity-export:'],
    ['/api/capacity-plans/p1/availability', 'api-general:'],
  ])('applies the right capacity tier to %s', (path, prefix) => {
    allowAll()
    proxy(makeRequest(path))
    const calls = checkRateLimit.mock.calls
    expect(calls.some(([key]) => key.startsWith(prefix))).toBe(true)
  })

  it('applies api-general tier to other API routes', () => {
    allowAll()
    proxy(makeRequest('/api/wheels'))
    const calls = checkRateLimit.mock.calls
    expect(calls.some(([key]) => key.startsWith('api-general:'))).toBe(true)
  })

  it('does NOT apply a per-route tier to page routes', () => {
    allowAll()
    proxy(makeRequest('/dashboard'))
    expect(checkRateLimit).toHaveBeenCalledTimes(1)
  })

  it('returns 429 when per-route tier is exceeded (global passes)', () => {
    blockOnCall(2)
    const res = proxy(makeRequest('/api/auth/login'))
    expect(res.status).toBe(429)
  })
})

describe('proxy - IP extraction', () => {
  it('uses the last (ALB-appended) IP in a comma-separated x-forwarded-for', () => {
    allowAll()
    proxy(makeRequest('/api/wheels', { xff: '10.0.0.1, 10.0.0.2, 10.0.0.3' }))
    const keys = checkRateLimit.mock.calls.map(([key]) => key)
    expect(keys.every(k => k.includes('10.0.0.3'))).toBe(true)
  })

  it('does not give a fresh bucket when the client rotates the spoofable XFF prefix (H2)', () => {
    allowAll()
    proxy(makeRequest('/api/auth/login', { xff: '1.1.1.1, 203.0.113.5' }))
    proxy(makeRequest('/api/auth/login', { xff: '2.2.2.2, 203.0.113.5' }))
    const keys = new Set(checkRateLimit.mock.calls.map(([key]) => key))
    expect([...keys].every(k => k.endsWith(':203.0.113.5'))).toBe(true)
  })

  it('falls back to "local" when no x-forwarded-for header is present', () => {
    allowAll()
    proxy(makeRequest('/api/wheels', { xff: null }))
    const keys = checkRateLimit.mock.calls.map(([key]) => key)
    expect(keys.every(k => k.includes('local'))).toBe(true)
  })

  it('isolates rate limits per IP', () => {
    allowAll()
    proxy(makeRequest('/api/auth/login', { xff: '1.1.1.1' }))
    proxy(makeRequest('/api/auth/login', { xff: '2.2.2.2' }))
    const keys = checkRateLimit.mock.calls.map(([key]) => key)
    expect(keys.some(k => k.includes('1.1.1.1'))).toBe(true)
    expect(keys.some(k => k.includes('2.2.2.2'))).toBe(true)
  })
})

describe('proxy - mock OAuth sandbox blocking (C1)', () => {
  const originalEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
  })

  it('blocks /auth/mock in production and rewrites to 404', () => {
    process.env.NODE_ENV = 'production'
    allowAll()
    const res = proxy(makeRequest('/auth/mock'))
    expect(res.status).toBe(404)
  })

  it('allows /auth/mock in development', () => {
    process.env.NODE_ENV = 'development'
    allowAll()
    const res = proxy(makeRequest('/auth/mock'))
    expect(res.status).not.toBe(404)
  })
})

// ── Security event logging ────────────────────────────────────────────────────

describe('proxy - rate limit security events', () => {
  let warn
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => warn.mockRestore())

  const events = () => warn.mock.calls.map(([line]) => JSON.parse(line))

  it('logs one JSON event when a client first exceeds a tier, with tier and IP', () => {
    checkRateLimit.mockImplementation((key) =>
      key.startsWith('global:')
        ? { allowed: true, remaining: 99, resetMs: Date.now() + 60_000 }
        : { allowed: false, remaining: 0, resetMs: Date.now() + 30_000, firstBlocked: true }
    )
    const res = proxy(makeRequest('/api/auth/login', { xff: '9.9.9.9' }))
    expect(res.status).toBe(429)
    expect(events()).toEqual([expect.objectContaining({ securityEvent: 'rate_limited', tier: 'auth-mutate', ip: '9.9.9.9' })])
  })

  it('does not log again for later requests in the same burst', () => {
    checkRateLimit.mockReturnValue({ allowed: false, remaining: 0, resetMs: Date.now() + 30_000, firstBlocked: false })
    expect(proxy(makeRequest('/')).status).toBe(429)
    expect(warn).not.toHaveBeenCalled()
  })

  it('logs global circuit-breaker blocks', () => {
    checkRateLimit.mockReturnValue({ allowed: false, remaining: 0, resetMs: Date.now() + 30_000, firstBlocked: true })
    proxy(makeRequest('/'))
    expect(events()).toEqual([expect.objectContaining({ securityEvent: 'rate_limited', tier: 'global', ip: '1.2.3.4' })])
  })
})

// ── Server Action probes ──────────────────────────────────────────────────────

describe('proxy - Server Action probes', () => {
  beforeEach(allowAll)

  function probe(pathname, actionId) {
    return new NextRequest(`https://localhost${pathname}`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '1.2.3.4', 'next-action': actionId },
    })
  }

  it.each([
    ['/', 'x'],
    ['/', '"x"'],
    ['/login', '0c8909fdc8f635acbff5155dcb5255804ce88618'],
  ])('returns 404 for %s with Next-Action %s', (pathname, actionId) => {
    const res = proxy(probe(pathname, actionId))
    expect(res.status).toBe(404)
  })

  it('rejects probes before rate limiting', () => {
    proxy(probe('/', 'x'))
    expect(checkRateLimit).not.toHaveBeenCalled()
  })

  it('lets requests without a Next-Action header through', () => {
    const res = proxy(makeRequest('/', { protocol: 'https' }))
    expect(res.status).toBe(200)
  })
})

// ── ALB health check ─────────────────────────────────────────────────────────

describe('proxy - ALB health check', () => {
  beforeEach(async () => {
    process.env.FORCE_HTTPS = 'true'
    jest.resetModules()
    ;({ checkRateLimit } = require('@/lib/rateLimit'))
    ;({ proxy } = await import('@/proxy'))
    allowAll()
  })

  afterEach(() => {
    delete process.env.FORCE_HTTPS
  })

  it('does not redirect the plain-HTTP health check to HTTPS', () => {
    const res = proxy(makeRequest('/api/health', { xff: null, protocol: 'http' }))
    expect(res.status).toBe(200)
  })

  it('does not rate-limit the health check', () => {
    proxy(makeRequest('/api/health', { xff: null, protocol: 'http' }))
    expect(checkRateLimit).not.toHaveBeenCalled()
  })

  it.each(['/api/healthz', '/api/health/x'])('still redirects and rate-limits %s', (pathname) => {
    expect(proxy(makeRequest(pathname, { protocol: 'http' })).status).toBe(301)
    proxy(makeRequest(pathname, { protocol: 'https' }))
    expect(checkRateLimit).toHaveBeenCalled()
  })
})

describe('proxy - rate limit accounting', () => {
  it('counts each request once per tier (the header reuses the check)', () => {
    allowAll()
    proxy(makeRequest('/api/wheels/abc/spin'))
    const keys = checkRateLimit.mock.calls.map(([key]) => key.split(':')[0])
    expect(keys).toEqual(['global', 'spin'])
  })
})
