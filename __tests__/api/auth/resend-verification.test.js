jest.mock('@/lib/dynamodb', () => {
  const { createFakeDynamo } = require('@/__tests__/helpers/fakeDynamo')
  return { docClient: createFakeDynamo(), TableNames: { Users: 'WheelApp_Users' } }
})
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/rateLimit', () => ({
  checkRateLimit: jest.fn().mockReturnValue({ allowed: true, resetMs: Date.now() + 1000 }),
}))

const { POST } = require('@/app/api/auth/resend-verification/route')
const { docClient } = require('@/lib/dynamodb')
const { sendEmail } = require('@/lib/email')
const { checkRateLimit } = require('@/lib/rateLimit')
const { hashToken } = require('@/lib/tokens')
const { seedUser, getUser, getPointer } = require('@/__tests__/helpers/users')

function makeRequest(body) {
  return new Request('http://localhost/api/auth/resend-verification', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  docClient.reset()
  sendEmail.mockResolvedValue(undefined)
  checkRateLimit.mockReturnValue({ allowed: true, resetMs: Date.now() + 1000 })
  seedUser(docClient, { userId: 'u1', username: 'alice', isVerified: false })
  seedUser(docClient, { userId: 'u2', username: 'bob', isVerified: true })
})

describe('POST /api/auth/resend-verification', () => {
  it('sends a new link and stores only its hash', async () => {
    const res = await POST(makeRequest({ email: 'alice@example.com' }))
    expect(res.status).toBe(200)
    const token = sendEmail.mock.calls[0][0].text.match(/token=([0-9a-f]+)/)[1]
    for (const item of [getUser(docClient, 'u1'), getPointer(docClient, 'alice')]) {
      expect(item.verificationToken).toBeUndefined()
      expect(item.verificationTokenHash).toBe(hashToken(token))
    }
  })

  it('returns the same reply for verified, unknown and missing emails, sending nothing', async () => {
    const bodies = await Promise.all([{ email: 'bob@example.com' }, { email: 'ghost@example.com' }, {}]
      .map(async (b) => (await POST(makeRequest(b))).json()))
    expect(new Set(bodies.map(JSON.stringify)).size).toBe(1)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('returns the generic reply even when SES fails', async () => {
    sendEmail.mockRejectedValueOnce(new Error('SES down'))
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(makeRequest({ email: 'alice@example.com' }))
    expect(res.status).toBe(200)
  })

  it('fails if rate limit is exceeded', async () => {
    checkRateLimit.mockReturnValueOnce({ allowed: false, resetMs: Date.now() + 1000 })
    expect((await POST(makeRequest({ email: 'alice@example.com' }))).status).toBe(429)
  })

  it('fails if database throws an error', async () => {
    docClient.beforeSend = () => { throw new Error('DB') }
    jest.spyOn(console, 'error').mockImplementation(() => {})
    expect((await POST(makeRequest({ email: 'alice@example.com' }))).status).toBe(500)
  })
})
