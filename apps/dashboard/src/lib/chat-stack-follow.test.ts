import { describe, expect, it } from 'vitest'
import {
  FOLLOW_LIMIT,
  FOLLOW_RECENT_MS,
  FOLLOW_TTL_MS,
  addFollow,
  pruneFollows,
  removeFollow,
  shouldFollowOnLeave,
  touchFollow,
} from './chat-stack-follow'
import { orderStackCards, stabilizeStackOrder, type StackCardState } from './chat-stack'

const NOW = 1_800_000_000_000

describe('chat stack follow rules', () => {
  it('keeps only the newest following conversation', () => {
    let rows = addFollow([], 'a', NOW - 3000)
    rows = addFollow(rows, 'b', NOW - 2000)
    rows = addFollow(rows, 'c', NOW)
    expect(rows.map((r) => r.id)).toEqual(['c'])
    expect(rows).toHaveLength(FOLLOW_LIMIT)
  })

  it('re-following the same conversation refreshes it without duplicates', () => {
    let rows = addFollow([], 'a', NOW - 2000)
    rows = addFollow(rows, 'b', NOW - 1000)
    rows = addFollow(rows, 'a', NOW)
    expect(rows.map((r) => r.id)).toEqual(['a'])
  })

  it('drops entries idle past the TTL', () => {
    const rows = pruneFollows(
      [
        { id: 'old', at: NOW - FOLLOW_TTL_MS - 1 },
        { id: 'fresh', at: NOW - 1000 },
      ],
      NOW,
    )
    expect(rows.map((r) => r.id)).toEqual(['fresh'])
  })

  it('touch refreshes only a followed id; remove drops it', () => {
    const rows = [{ id: 'a', at: NOW - 5000 }]
    expect(touchFollow(rows, 'a', NOW)[0].at).toBe(NOW)
    expect(touchFollow(rows, 'b', NOW)).toBe(rows)
    expect(removeFollow(rows, 'a')).toEqual([])
  })

  it('follows on leave for a working agent, a draft or recent activity', () => {
    const base = { agentWorking: false, hasDraft: false, lastActivityAt: null, now: NOW }
    expect(shouldFollowOnLeave(base)).toBe(false)
    expect(shouldFollowOnLeave({ ...base, agentWorking: true })).toBe(true)
    expect(shouldFollowOnLeave({ ...base, hasDraft: true })).toBe(true)
    expect(shouldFollowOnLeave({ ...base, lastActivityAt: NOW - FOLLOW_RECENT_MS + 10 })).toBe(true)
    expect(shouldFollowOnLeave({ ...base, lastActivityAt: NOW - FOLLOW_RECENT_MS - 10 })).toBe(false)
  })
})

function card(id: string, patch: Partial<StackCardState> = {}): StackCardState {
  return {
    id,
    title: id,
    preview: '',
    previewAuthor: null,
    previewBy: 'agent',
    unread: false,
    status: 'open',
    channel: 'email',
    pinned: true,
    lastActivityAt: null,
    agents: [],
    live: false,
    liveSummary: null,
    liveAgentName: null,
    callPhase: null,
    ...patch,
  }
}

describe('stack card order', () => {
  it('puts call, then unread, then most recent first (live does not reshuffle)', () => {
    const ordered = orderStackCards([
      card('old', { lastActivityAt: '2026-01-01T00:00:00Z' }),
      card('recent', { lastActivityAt: '2026-02-01T00:00:00Z' }),
      card('unread', { unread: true }),
      card('live', { live: true, lastActivityAt: '2026-01-15T00:00:00Z' }),
      card('ringing', { callPhase: 'ringing' }),
    ])
    expect(ordered.map((c) => c.id)).toEqual(['ringing', 'unread', 'recent', 'live', 'old'])
  })

  it('keeps the other cards still while a call stays in front', () => {
    const ordered = stabilizeStackOrder(
      [
        card('b', { lastActivityAt: '2026-03-01T00:00:00Z' }),
        card('fresh', { lastActivityAt: '2026-04-01T00:00:00Z' }),
        card('a', { lastActivityAt: '2026-01-01T00:00:00Z' }),
        card('call', { callPhase: 'live', lastActivityAt: '2026-02-01T00:00:00Z' }),
      ],
      ['call', 'a', 'b'],
    )
    expect(ordered.map((c) => c.id)).toEqual(['call', 'a', 'b', 'fresh'])
  })
})
