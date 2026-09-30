import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import type { Decision } from '@/api/types'
import { authStore } from '@/lib/auth-store'
import { DecisionCard } from './DecisionCard'

const base: Decision = {
  id: 'd1',
  conversation_id: 'c1',
  message_id: null,
  run_id: null,
  title: 'Send reply to customer',
  summary: 'The agent wants to send a reply.',
  status: 'open',
  options: [],
  tool_call: { name: 'send_reply', args: { body: 'Hello' } },
  requested_by: 'agent:support',
  chosen_option: null,
  resolution_note: '',
  resolved_by_user_id: null,
  result: null,
  expires_at: null,
  created_at: '2026-09-30T10:00:00Z',
  resolved_at: null,
}

function renderCard(decision: Decision) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <DecisionCard decision={decision} />
    </QueryClientProvider>,
  )
}

describe('DecisionCard', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
    authStore.clear()
  })

  it('shows default approve and reject options for an open decision', () => {
    renderCard(base)
    expect(screen.getByText('Send reply to customer')).toBeTruthy()
    expect(screen.getByText('send_reply')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy()
  })

  it('posts the chosen option to the decisions API', async () => {
    authStore.setToken('tok', 't1')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ...base, status: 'approved', chosen_option: 'approve' }), { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    renderCard(base)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.toString()).toContain('/api/decisions/d1/resolve')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toMatchObject({ option: 'approve' })
  })

  it('renders the outcome once resolved', () => {
    renderCard({ ...base, status: 'rejected', chosen_option: 'reject', resolution_note: 'Not now' })
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.getByText(/Chosen/)).toBeTruthy()
    expect(screen.getByText(/Not now/)).toBeTruthy()
  })
})
