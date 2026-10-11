import { describe, expect, it } from 'vitest'
import {
  dedicatedInboxQueueForStatus,
  pickRemainingInboxThread,
  resolvedStatusLeavesInboxQueue,
  threadFitsInboxQueue,
} from './inbox-queue'

describe('threadFitsInboxQueue', () => {
  it('keeps open customer and assistant chats in Open; hides agent runs', () => {
    expect(
      threadFitsInboxQueue({ status: 'open', assignedToUserId: null, channel: 'email', folder: 'inbox' }, 'open', 1),
    ).toBe(true)
    expect(
      threadFitsInboxQueue(
        { status: 'open', assignedToUserId: null, channel: 'assistant', folder: 'assistant' },
        'open',
        1,
      ),
    ).toBe(true)
    expect(
      threadFitsInboxQueue({ status: 'closed', assignedToUserId: null, channel: 'email', folder: 'inbox' }, 'open', 1),
    ).toBe(false)
    expect(
      threadFitsInboxQueue({ status: 'open', assignedToUserId: null, channel: 'internal', folder: 'internal' }, 'open', 1),
    ).toBe(false)
  })

  it('drops closed and spam from All', () => {
    expect(
      threadFitsInboxQueue({ status: 'open', assignedToUserId: null, channel: 'email', folder: 'inbox' }, 'all', 1),
    ).toBe(true)
    expect(
      threadFitsInboxQueue({ status: 'closed', assignedToUserId: null, channel: 'email', folder: 'inbox' }, 'all', 1),
    ).toBe(false)
    expect(
      threadFitsInboxQueue({ status: 'spam', assignedToUserId: null, channel: 'email', folder: 'inbox' }, 'all', 1),
    ).toBe(false)
    expect(
      threadFitsInboxQueue({ status: 'pending', assignedToUserId: null, channel: 'email', folder: 'inbox' }, 'all', 1),
    ).toBe(true)
  })
})

describe('resolvedStatusLeavesInboxQueue', () => {
  it('leaves Open/All/For you after close, but stays on Closed', () => {
    expect(resolvedStatusLeavesInboxQueue('closed', 'open')).toBe(true)
    expect(resolvedStatusLeavesInboxQueue('closed', 'all')).toBe(true)
    expect(resolvedStatusLeavesInboxQueue('closed', 'for_you')).toBe(true)
    expect(resolvedStatusLeavesInboxQueue('closed', 'closed')).toBe(false)
  })

  it('has no park queue for pending threads', () => {
    expect(resolvedStatusLeavesInboxQueue('pending', 'open')).toBe(false)
    expect(dedicatedInboxQueueForStatus('pending')).toBeNull()
  })
})

describe('scheduled queue', () => {
  it('keeps every dated thread, closed ones included', () => {
    const base = { assignedToUserId: null, channel: 'internal', folder: 'internal' }
    expect(threadFitsInboxQueue({ ...base, status: 'closed', nextAt: '2026-10-12T07:00:00Z' }, 'scheduled', 1)).toBe(
      true,
    )
    expect(threadFitsInboxQueue({ ...base, status: 'open', nextAt: null }, 'scheduled', 1)).toBe(false)
  })
})

describe('pickRemainingInboxThread', () => {
  it('returns the first remaining thread in the current box', () => {
    const threads = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(pickRemainingInboxThread(threads, 'b')?.id).toBe('a')
    expect(pickRemainingInboxThread(threads, 'a')?.id).toBe('b')
  })

  it('returns null when the box is empty after leaving', () => {
    expect(pickRemainingInboxThread([{ id: 'only' }], 'only')).toBeNull()
    expect(pickRemainingInboxThread([], 'gone')).toBeNull()
  })
})
