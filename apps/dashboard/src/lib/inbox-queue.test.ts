import { describe, expect, it } from 'vitest'
import {
  dedicatedInboxQueueForStatus,
  pickRemainingInboxThread,
  resolvedStatusLeavesInboxQueue,
  threadFitsInboxQueue,
} from './inbox-queue'

describe('threadFitsInboxQueue', () => {
  it('keeps only open customer threads in Open', () => {
    expect(
      threadFitsInboxQueue({ status: 'open', assignedToUserId: null, channel: 'email', folder: 'inbox' }, 'open', 1),
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
  it('leaves Open/All/Mine after close, but stays on Closed', () => {
    expect(resolvedStatusLeavesInboxQueue('closed', 'open')).toBe(true)
    expect(resolvedStatusLeavesInboxQueue('closed', 'all')).toBe(true)
    expect(resolvedStatusLeavesInboxQueue('closed', 'mine')).toBe(true)
    expect(resolvedStatusLeavesInboxQueue('closed', 'closed')).toBe(false)
  })

  it('parks pending threads out of Open into Snoozed', () => {
    expect(resolvedStatusLeavesInboxQueue('pending', 'open')).toBe(true)
    expect(resolvedStatusLeavesInboxQueue('pending', 'snoozed')).toBe(false)
    expect(dedicatedInboxQueueForStatus('pending')).toBe('snoozed')
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
