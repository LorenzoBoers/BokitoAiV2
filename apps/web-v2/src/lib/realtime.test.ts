import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import { applyEvent } from './realtime'

function keysInvalidated(e: Parameters<typeof applyEvent>[1]) {
  const qc = new QueryClient()
  const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined)
  applyEvent(qc, e)
  return spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown[] }).queryKey))
}

describe('applyEvent', () => {
  it('invalidates list and thread for a conversation event', () => {
    const keys = keysInvalidated({ topic: 'conversations', id: 'c1' })
    expect(keys).toContain(JSON.stringify(['conversations']))
    expect(keys).toContain(JSON.stringify(['thread', 'c1']))
    expect(keys).toContain(JSON.stringify(['conversation', 'c1']))
  })

  it('maps per-conversation topics onto that thread', () => {
    const keys = keysInvalidated({ topic: 'conversation:abc', event: 'message' })
    expect(keys).toContain(JSON.stringify(['thread', 'abc']))
    expect(keys).toContain(JSON.stringify(['conversations']))
  })

  it('maps run topics onto the run and the ledger', () => {
    const keys = keysInvalidated({ topic: 'run:r1' })
    expect(keys).toEqual([JSON.stringify(['run', 'r1']), JSON.stringify(['runs'])])
  })

  it('refreshes decisions on decision and notification topics', () => {
    expect(keysInvalidated({ topic: 'decisions' })).toContain(JSON.stringify(['decisions']))
    expect(keysInvalidated({ topic: 'notifications' })).toEqual([JSON.stringify(['decisions'])])
  })

  it('ignores unknown topics', () => {
    expect(keysInvalidated({ topic: 'something-else' })).toEqual([])
  })
})
