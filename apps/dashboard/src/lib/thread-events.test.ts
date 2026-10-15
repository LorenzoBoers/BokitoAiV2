import { describe, expect, it } from 'vitest'
import { threadPatchHasMeaning, withTagDiffs } from './thread-events'

describe('threadPatchHasMeaning', () => {
  it('is false for empty or metadata-only patches', () => {
    expect(threadPatchHasMeaning(null)).toBe(false)
    expect(threadPatchHasMeaning({})).toBe(false)
    expect(threadPatchHasMeaning({ actor: 'user' })).toBe(false)
  })

  it('is true when status, assignee, priority or tags change', () => {
    expect(threadPatchHasMeaning({ status: 'closed' })).toBe(true)
    expect(threadPatchHasMeaning({ assigned_to: 3 })).toBe(true)
    expect(threadPatchHasMeaning({ priority: 'high' })).toBe(true)
    expect(threadPatchHasMeaning({ tags: [] })).toBe(true)
    expect(threadPatchHasMeaning({ tags_added: ['administratie'] })).toBe(true)
    expect(threadPatchHasMeaning({ tags_removed: ['old'] })).toBe(true)
    expect(threadPatchHasMeaning({ bulk: 'reopen' })).toBe(true)
  })
})

describe('withTagDiffs', () => {
  it('fills tags_added with only the newly applied label each step', () => {
    const events = [
      {
        eventType: 'thread_updated',
        createdAt: '2026-10-14T21:00:00Z',
        payload: { tags: ['administratie'] },
      },
      {
        eventType: 'thread_updated',
        createdAt: '2026-10-14T21:01:00Z',
        payload: { tags: ['administratie', 'columbus_ict'] },
      },
      {
        eventType: 'thread_updated',
        createdAt: '2026-10-14T21:02:00Z',
        payload: { tags: ['administratie', 'columbus_ict', 'documentatie'] },
      },
    ]

    const next = withTagDiffs(events)
    expect(next[0].payload.tags_added).toEqual(['administratie'])
    expect(next[1].payload.tags_added).toEqual(['columbus_ict'])
    expect(next[2].payload.tags_added).toEqual(['documentatie'])
  })

  it('keeps API-provided diffs and still tracks removals', () => {
    const events = [
      {
        eventType: 'thread_updated',
        createdAt: '2026-10-14T21:00:00Z',
        payload: { tags: ['a', 'b'], tags_added: ['a', 'b'], tags_removed: [] },
      },
      {
        eventType: 'thread_updated',
        createdAt: '2026-10-14T21:01:00Z',
        payload: { tags: ['a'] },
      },
    ]

    const next = withTagDiffs(events)
    expect(next[0].payload.tags_added).toEqual(['a', 'b'])
    expect(next[1].payload.tags_added).toEqual([])
    expect(next[1].payload.tags_removed).toEqual(['b'])
  })
})
