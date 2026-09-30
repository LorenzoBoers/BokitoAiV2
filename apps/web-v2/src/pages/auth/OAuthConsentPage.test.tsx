import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import { authStore } from '@/lib/auth-store'
import { OAuthConsentPage } from './OAuthConsentPage'

const QUERY =
  '?client_id=mcp_abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fcb&scope=read+tools&state=s1&code_challenge=ch&code_challenge_method=S256'

describe('OAuthConsentPage', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
    authStore.clear()
  })

  it('loads the client context and posts the approval with every OAuth parameter', async () => {
    authStore.setToken('tok', 't1')
    const assign = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign },
    })
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = input.toString()
      if (url.includes('/api/oauth/consent-context')) {
        return new Response(
          JSON.stringify({
            client_id: 'mcp_abc',
            client_name: 'Cursor',
            redirect_uris: ['http://127.0.0.1:3000/cb'],
            scopes: ['read', 'write', 'tools'],
            workspace_name: 'Acme',
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ redirect_to: 'http://127.0.0.1:3000/cb?code=xyz&state=s1' }), {
        status: 200,
      })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    render(
      <MemoryRouter initialEntries={[`/oauth/consent${QUERY}`]}>
        <OAuthConsentPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText(/Cursor asks for access/)).toBeTruthy())
    expect(screen.getByText('read')).toBeTruthy()
    expect(screen.getByText('tools')).toBeTruthy()
    expect(screen.queryByText('write')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://127.0.0.1:3000/cb?code=xyz&state=s1'))

    const consentCall = fetchMock.mock.calls.find(([u]) => u.toString().includes('/api/oauth/consent') && !u.toString().includes('context'))
    expect(consentCall).toBeTruthy()
    const init = consentCall![1] as unknown as RequestInit
    expect(JSON.parse(String(init.body))).toMatchObject({
      approve: true,
      client_id: 'mcp_abc',
      redirect_uri: 'http://127.0.0.1:3000/cb',
      scope: 'read tools',
      state: 's1',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    })
  })
})
