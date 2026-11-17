const nextJest = require('next/jest')

const createJestConfig = nextJest({ dir: './' })

/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
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
