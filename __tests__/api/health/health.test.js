import { GET } from '@/app/api/health/route'

describe('GET /api/health', () => {
  it('returns 200 with a static body', async () => {
    const res = GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('is never cached', () => {
    expect(GET().headers.get('Cache-Control')).toBe('no-store')
  })
})
