const nextJest = require('next/jest')

const createJestConfig = nextJest({ dir: './' })

/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  // Keeps tests offline (e.g. no Have I Been Pwned calls); see the file.
  setupFiles: ['<rootDir>/__tests__/helpers/jestEnv.js'],
  // `npm run test:coverage` (CI) fails below these. Global numbers are the
  // baseline when this was added, so coverage can only go up; the security
  // modules (sessions, MFA, crypto, OAuth, audit, CSRF/CSP, rate limits,
  // tokens) must stay near-complete.
  collectCoverageFrom: ['{app,lib,components}/**/*.js', 'proxy.js'],
  coverageThreshold: {
    global: { statements: 71, branches: 61, functions: 63, lines: 72 },
    ...Object.fromEntries(
      [
        './lib/sessions/', './lib/mfa/', './lib/crypto/', './lib/users/',
        './lib/audit.js', './lib/csrf.js', './lib/csp.js', './lib/sharedRateLimit.js',
        './lib/tokens.js', './lib/clientIp.js', './lib/session.js', './lib/oauth.js',
      ].map((p) => [p, { statements: 95, branches: 85, functions: 95, lines: 95 }])
    ),
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/.next/',
    '<rootDir>/__tests__/infra/helpers/',
    '<rootDir>/__tests__/helpers/',
    '<rootDir>/e2e/', // Playwright specs; run with `npm run test:e2e`
  ],
}

module.exports = async () => {
  const jestConfig = await createJestConfig(config)()
  // Patch the first transformIgnorePatterns to also allow jose
  jestConfig.transformIgnorePatterns = jestConfig.transformIgnorePatterns.map(pattern => {
    // Match the Next.js default pattern and inject jose into its exception list
    if (pattern.includes('next/dist/client')) {
      return pattern.replace(
        '(geist|next/dist/client',
        '(jose|geist|next/dist/client'
      )
    }
    return pattern
  })
  return jestConfig
}
