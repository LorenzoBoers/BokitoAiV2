import { describe, expect, it } from 'vitest'
import {
  nextUnreadId,
  parseComposerDraft,
  parseQuickFilterParam,
  serializeComposerDraft,
  suggestSavedSearchName,
  toggleOrRangeSelect,
} from './inbox-ops'

describe('toggleOrRangeSelect', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('toggles a single id without shift', () => {
    const first = toggleOrRangeSelect(ids, new Set(), 'b', null, false)
    expect([...first.next]).toEqual(['b'])
    const second = toggleOrRangeSelect(ids, first.next, 'b', first.anchor, false)
    expect([...second.next]).toEqual([])
  })

  it('selects an inclusive range on shift-click', () => {
    const anchored = toggleOrRangeSelect(ids, new Set(), 'b', null, false)
    const ranged = toggleOrRangeSelect(ids, anchored.next, 'd', anchored.anchor, true)
    expect([...ranged.next].sort()).toEqual(['b', 'c', 'd'])
  })
})

describe('nextUnreadId', () => {
  const threads = [
    { id: '1', hasUnread: false },
    { id: '2', hasUnread: true },
    { id: '3', hasUnread: false },
    { id: '4', hasUnread: true },
  ]

  it('jumps forward and wraps to the next unread', () => {
    expect(nextUnreadId(threads, '1', 1)).toBe('2')
    expect(nextUnreadId(threads, '2', 1)).toBe('4')
    expect(nextUnreadId(threads, '4', 1)).toBe('2')
  })

  it('jumps backward', () => {
    expect(nextUnreadId(threads, '4', -1)).toBe('2')
    expect(nextUnreadId(threads, '2', -1)).toBe('4')
  })

  it('returns null when nothing is unread', () => {
    expect(nextUnreadId([{ id: '1', hasUnread: false }], '1', 1)).toBeNull()
  })
})

describe('parseQuickFilterParam', () => {
  it('accepts URL aliases', () => {
    expect(parseQuickFilterParam('needs_reply')).toBe('needsReply')
    expect(parseQuickFilterParam('needs_decision')).toBe('needsDecision')
    expect(parseQuickFilterParam('awaiting_decision')).toBe('needsDecision')
    expect(parseQuickFilterParam('unread')).toBe('unread')
    expect(parseQuickFilterParam('nope')).toBeNull()
  })
})

describe('suggestSavedSearchName', () => {
  it('keeps a short query and trims operators', () => {
    expect(suggestSavedSearchName('  factuur  ')).toBe('factuur')
    expect(suggestSavedSearchName('from:sanne invoice overdue')).toBe('sanne invoice overdue')
  })

  it('shortens a long query', () => {
    const name = suggestSavedSearchName('outstanding-invoice-reminder-for-last-quarter')
    expect(name.endsWith('...')).toBe(true)
    expect(name.length).toBeLessThanOrEqual(32)
  })
})

describe('composer draft json', () => {
  it('round-trips cc/bcc and keeps legacy plain text', () => {
    expect(parseComposerDraft('hello')).toEqual({ body: 'hello', cc: '', bcc: '' })
    const packed = serializeComposerDraft({ body: 'hi', cc: 'a@b.c', bcc: '' })
    expect(parseComposerDraft(packed)).toEqual({ body: 'hi', cc: 'a@b.c', bcc: '' })
  })
})
