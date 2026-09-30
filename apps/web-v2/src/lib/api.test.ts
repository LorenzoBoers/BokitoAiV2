import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { ApiError, api } from './api'
import { authStore } from './auth-store'

describe('api transport', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    authStore.clear()
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('surfaces the API error envelope as ApiError', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: 'not_found', message: 'Nope' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as typeof fetch

    const expected: Partial<ApiError> = {
      status: 404,
      code: 'not_found',
      message: 'Nope',
    }
    await expect(api.get('/x')).rejects.toMatchObject(expected)
  })

  it('sends the bearer token and query params', async () => {
    authStore.setToken('tok', 't1')
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await api.get('/health', { q: 'a', skip: undefined })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.toString()).toContain('/api/health?q=a')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })
})
