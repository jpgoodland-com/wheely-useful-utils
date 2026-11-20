jest.mock('@/lib/dynamodb', () => {
  const { createFakeDynamo } = require('@/__tests__/helpers/fakeDynamo')
  return { docClient: createFakeDynamo(), TableNames: { Users: 'WheelApp_Users' } }
})
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/rateLimit', () => ({
  checkRateLimit: jest.fn().mockReturnValue({ allowed: true, resetMs: Date.now() + 1000 }),
}))

const { POST } = require('@/app/api/auth/forgot-password/route')
const { docClient } = require('@/lib/dynamodb')
const { sendEmail } = require('@/lib/email')
const { checkRateLimit } = require('@/lib/rateLimit')
const { hashToken } = require('@/lib/tokens')
const { seedUser, getUser, getPointer, USERS_TABLE } = require('@/__tests__/helpers/users')

function makeRequest(body) {
  return new Request('http://localhost/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const GENERIC = { success: true, message: 'If an account with that email exists, a password reset link has been sent.' }

beforeEach(() => {
  jest.clearAllMocks()
  docClient.reset()
  sendEmail.mockResolvedValue(undefined)
  checkRateLimit.mockReturnValue({ allowed: true, resetMs: Date.now() + 1000 })
  seedUser(docClient, { userId: 'u1', username: 'alice', email: 'alice@example.com' })
})

describe('POST /api/auth/forgot-password', () => {
  it('stores only the hash of the emailed token, on both items', async () => {
    const res = await POST(makeRequest({ email: 'Alice@Example.com' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(GENERIC)

    const token = sendEmail.mock.calls[0][0].text.match(/token=([0-9a-f]+)/)[1]
    for (const item of [getUser(docClient, 'u1'), getPointer(docClient, 'alice')]) {
      expect(item.passwordResetToken).toBeUndefined()
      expect(item.passwordResetTokenHash).toBe(hashToken(token))
      expect(new Date(item.passwordResetExpiry).getTime()).toBeGreaterThan(Date.now())
    }
  })

  it('returns the generic reply for an unknown email without sending anything', async () => {
    const res = await POST(makeRequest({ email: 'nobody@example.com' }))
    expect(await res.json()).toEqual(GENERIC)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('ignores a legacy username that looks like the email (C1)', async () => {
    docClient.put(USERS_TABLE, { PK: 'USER#USERNAME#victim@corp.com', userId: 'evil', username: 'victim@corp.com', email: 'evil@example.com', EmailOrUsername: 'victim@corp.com' })
    await POST(makeRequest({ email: 'victim@corp.com' }))
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('returns the generic reply even when SES fails, so failures reveal nothing', async () => {
    sendEmail.mockRejectedValueOnce(new Error('SES down'))
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(makeRequest({ email: 'alice@example.com' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(GENERIC)
  })

  it('fails if rate limit is exceeded', async () => {
    checkRateLimit.mockReturnValueOnce({ allowed: false, resetMs: Date.now() + 1000 })
    expect((await POST(makeRequest({ email: 'alice@example.com' }))).status).toBe(429)
  })

  it('returns 200 even if email is missing', async () => {
    expect((await POST(makeRequest({}))).status).toBe(200)
  })

  it('fails if database throws an error', async () => {
    docClient.beforeSend = () => { throw new Error('DB') }
    jest.spyOn(console, 'error').mockImplementation(() => {})
    expect((await POST(makeRequest({ email: 'alice@example.com' }))).status).toBe(500)
  })
})
