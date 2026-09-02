import { describe, expect, it } from 'vitest'
import {
  mergeSessionLiveMessages,
  type SessionStreamState,
} from './use-agent-session-chat'
import type { ChatMessage } from './signals-api'

describe('mergeSessionLiveMessages', () => {
  const base: ChatMessage[] = [
    { id: '1', role: 'user', content: 'hi', created_at: '2026-01-01T00:00:00Z' },
  ]

  it('returns base when stream is idle', () => {
    const stream: SessionStreamState = {
      text: '',
      thinking: '',
      active: false,
      optimisticUser: null,
    }
    expect(mergeSessionLiveMessages(base, stream)).toEqual(base)
  })

  it('appends optimistic user and streaming assistant', () => {
    const stream: SessionStreamState = {
      text: 'Hello',
      thinking: '',
      active: true,
      optimisticUser: {
        id: 'local-1',
        role: 'user',
        content: 'ping',
        created_at: '2026-01-01T00:00:01Z',
      },
    }
    const merged = mergeSessionLiveMessages(base, stream)
    expect(merged).toHaveLength(3)
    expect(merged?.[1]?.content).toBe('ping')
    expect(merged?.[2]?.id).toBe('local-stream')
    expect(merged?.[2]?.content).toBe('Hello')
  })
})
