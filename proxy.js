import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rateLimit'
import { logSecurityEvent } from '@/lib/securityLog'
import { getClientIp as clientIpFromHeaders } from '@/lib/clientIp'
import { csrfViolation } from '@/lib/csrf'
import { API_CSP, newNonce, pageCsp } from '@/lib/csp'
import { getTrustedBaseUrl } from '@/lib/url'

/**
 * Rate-limit tiers (requests / windowMs):
 *
 *  auth-mutate  – login & signup:  10 req / 60 s   (brute-force / credential stuffing)
 *  spin         – wheel spin:      30 req / 60 s   (noisy-neighbor / abuse)
 *  coin-toss    – coin flips:      60 req / 60 s   (abuse / storage churn)
 *  coin-config  – coin settings:   20 req / 60 s   (image uploads, writes)
 *  capacity-share  – plan members & sharing: 20 req / 60 s (user-identifier probing)
 *  capacity-export – plan CSV/Excel export:  10 req / 60 s (CPU-heavy file generation)
 *  api-general  – all other API:  120 req / 60 s   (general DoS)
 *  global       – every request:  300 req / 60 s   (DDoS circuit-breaker)
 */
const TIERS = {
  'auth-mutate': { limit: 10,  windowMs: 60_000 },
  spin:          { limit: 30,  windowMs: 60_000 },
  'coin-toss':   { limit: 60,  windowMs: 60_000 },
  'coin-config': { limit: 20,  windowMs: 60_000 },
  'capacity-share':  { limit: 20, windowMs: 60_000 },
  'capacity-export': { limit: 10, windowMs: 60_000 },
  'api-general': { limit: 120, windowMs: 60_000 },
  global:        { limit: 300, windowMs: 60_000 },
}


// HSTS: tell browsers to only ever use HTTPS for this origin for 1 year,
// including all subdomains, and allow preloading.
const HSTS_VALUE = 'max-age=31536000; includeSubDomains; preload'

function rateLimitedResponse(resetMs) {
  const retryAfterSecs = Math.ceil((resetMs - Date.now()) / 1000)
  return new Response(
    JSON.stringify({ error: 'Too Many Requests' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(Math.max(1, retryAfterSecs)),
        'X-RateLimit-Reset': String(resetMs),
      },
    }
  )
}

function getTier(pathname) {
  if (
    pathname === '/api/auth/login' ||
    pathname === '/api/auth/signup' ||
    pathname === '/api/auth/forgot-password' ||
    pathname === '/api/auth/reset-password' ||
    pathname === '/api/auth/resend-verification' ||
    pathname === '/api/auth/reauth' ||
    pathname === '/api/auth/mfa/verify' ||
    pathname === '/api/admin/invite/accept'
  ) return 'auth-mutate'

  if (pathname.match(/^\/api\/wheels\/[^/]+\/spin$/)) return 'spin'

  if (pathname === '/api/coin-flip/toss') return 'coin-toss'
  if (
    pathname === '/api/coin-flip/config' ||
    pathname.startsWith('/api/coin-flip/config/') ||
    pathname === '/api/coin-flip/active' ||
    pathname === '/api/coin-flip/history'
  ) return 'coin-config'

  if (pathname.match(/^\/api\/capacity-plans\/[^/]+\/(members|access)(\/|$)/)) return 'capacity-share'
  if (pathname.match(/^\/api\/capacity-plans\/[^/]+\/export$/)) return 'capacity-export'

  if (pathname.startsWith('/api/')) return 'api-general'

  return null // no per-route tier for non-API paths
}

// The ALB health check calls this path over plain HTTP, every 30s from
// each ALB node, with no X-Forwarded-For. Let it skip the HTTPS redirect (a
// 301 would hide a broken task) and the rate limits (it would share the
// 'local' bucket).
const HEALTH_CHECK_PATH = '/api/health'

export function proxy(request) {
  const { pathname } = request.nextUrl

  if (pathname === HEALTH_CHECK_PATH) {
    return NextResponse.next()
  }

  // ── Transit security ────────────────────────────────────────────────────────
  // Redirect plain HTTP to HTTPS only when explicitly enabled.
  // Set FORCE_HTTPS=true in production (ECS task definition).
  // Leave it unset for local Docker development.
  if (process.env.FORCE_HTTPS === 'true' && request.nextUrl.protocol === 'http:') {
    const httpsUrl = new URL(request.url)
    httpsUrl.protocol = 'https:'
    return NextResponse.redirect(httpsUrl, { status: 301 })
  }

  // C1: Block the mock OAuth sandbox outside of development
  if (
    process.env.NODE_ENV !== 'development' &&
    pathname.startsWith('/auth/mock')
  ) {
    return NextResponse.rewrite(new URL('/not-found', request.url), {
      status: 404,
    })
  }

  // The app defines no Server Actions, so any request carrying a
  // Next-Action header is a scanner probing for RSC/Server Action bugs.
  // Reject it here instead of letting Next.js log an error for each one.
  // Remove this if the app ever adds a "use server" function.
  if (request.headers.has('next-action')) {
    return new Response(null, { status: 404 })
  }

  const ip = clientIpFromHeaders(request.headers)

  // M2: refuse state-changing requests sent from another site.
  const csrf = csrfViolation(request, new URL(getTrustedBaseUrl(request)).origin)
  if (csrf) {
    logSecurityEvent('csrf_blocked', { reason: csrf, ip })
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // 1. Global circuit-breaker — catches DDoS across all paths
  const global = checkRateLimit(`global:${ip}`, TIERS.global.limit, TIERS.global.windowMs)
  if (!global.allowed) {
    if (global.firstBlocked) logSecurityEvent('rate_limited', { tier: 'global', ip })
    return rateLimitedResponse(global.resetMs)
  }

  // 2. Per-route tier — catches DoS / noisy-neighbor on specific endpoints
  const tier = getTier(pathname)
  const tierResult = tier ? checkRateLimit(`${tier}:${ip}`, TIERS[tier].limit, TIERS[tier].windowMs) : null
  if (tierResult && !tierResult.allowed) {
    if (tierResult.firstBlocked) logSecurityEvent('rate_limited', { tier, ip })
    return rateLimitedResponse(tierResult.resetMs)
  }

  // M1: pages get a per-request nonce CSP. Next.js reads the policy from the
  // request headers while rendering and puts the nonce on its scripts.
  const isApi = pathname.startsWith('/api/')
  let response
  if (isApi) {
    response = NextResponse.next()
    response.headers.set('Content-Security-Policy', API_CSP)
  } else {
    const csp = pageCsp(newNonce(), {
      dev: process.env.NODE_ENV === 'development',
      https: process.env.FORCE_HTTPS === 'true',
    })
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('Content-Security-Policy', csp)
    response = NextResponse.next({ request: { headers: requestHeaders } })
    response.headers.set('Content-Security-Policy', csp)
  }

  // ── HSTS ────────────────────────────────────────────────────────────────────
  if (process.env.FORCE_HTTPS === 'true') {
    response.headers.set('Strict-Transport-Security', HSTS_VALUE)
  }

  // ── Page caching ────────────────────────────────────────────────────────────
  // Prerendered pages ship with `s-maxage=31536000`, which lets browsers/CDNs
  // keep serving stale HTML (and stale feature cards) after a deploy. Force
  // revalidation for pages; hashed /_next/static assets are excluded by the
  // matcher and stay immutable.
  if (!isApi) {
    response.headers.set('Cache-Control', 'private, no-cache, must-revalidate')
  }

  // Reuses the check above: counting the request a second time would halve
  // every tier's real limit.
  if (tierResult) {
    response.headers.set('X-RateLimit-Limit', String(TIERS[tier].limit))
    response.headers.set('X-RateLimit-Remaining', String(tierResult.remaining))
  }

  return response
}

export const config = {
  // Run on all routes; static assets are excluded by Next.js automatically
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
