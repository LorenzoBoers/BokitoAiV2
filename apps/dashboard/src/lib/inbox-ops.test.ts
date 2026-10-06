import { describe, expect, it } from 'vitest'
import {
  isStoredDraftStale,
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
    expect(parseQuickFilterParam('needs_reply')).toBe('forYou')
    expect(parseQuickFilterParam('needs_decision')).toBe('forYou')
    expect(parseQuickFilterParam('awaiting_decision')).toBe('forYou')
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

  it('keeps the proposal anchor and drops empty anchors', () => {
    const packed = serializeComposerDraft({
      body: 'hi',
      cc: '',
      bcc: '',
      decisionMessageId: 'card-1',
      basedOnMessageId: 'msg-1',
    })
    expect(packed.startsWith('{')).toBe(true)
    expect(parseComposerDraft(packed)).toEqual({
      body: 'hi',
      cc: '',
      bcc: '',
      decisionMessageId: 'card-1',
      basedOnMessageId: 'msg-1',
    })
    // A plain body without anchors stays plain text for older readers.
    expect(serializeComposerDraft({ body: 'plain', cc: '', bcc: '' })).toBe('plain')
    expect(parseComposerDraft('{"body":"x","basedOnMessageId":""}')).toEqual({ body: 'x', cc: '', bcc: '' })
  })
})

describe('isStoredDraftStale', () => {
  const draft = { body: 'Beste Harold, morgen.', cc: '', bcc: '', basedOnMessageId: 'msg-1' }

  it('is fresh while the anchored message is still the newest inbound', () => {
    expect(isStoredDraftStale(draft, { latestInboundMessageId: 'msg-1' })).toBe(false)
  })

  it('is stale once the customer wrote again', () => {
    expect(isStoredDraftStale(draft, { latestInboundMessageId: 'msg-2' })).toBe(true)
  })

  it('is stale when the proposal it came from was resolved or set aside', () => {
    const fromCard = { ...draft, decisionMessageId: 'card-1' }
    expect(
      isStoredDraftStale(fromCard, { latestInboundMessageId: 'msg-1', proposalOpen: () => false }),
    ).toBe(true)
    expect(
      isStoredDraftStale(fromCard, { latestInboundMessageId: 'msg-1', proposalOpen: () => true }),
    ).toBe(false)
    // Unknown card state (not loaded yet) falls back to the anchor.
    expect(
      isStoredDraftStale(fromCard, { latestInboundMessageId: 'msg-1', proposalOpen: () => undefined }),
    ).toBe(false)
  })

  it('never flags legacy drafts without an anchor or empty bodies', () => {
    expect(isStoredDraftStale({ body: 'old text', cc: '', bcc: '' }, { latestInboundMessageId: 'msg-9' })).toBe(false)
    expect(isStoredDraftStale({ ...draft, body: '  ' }, { latestInboundMessageId: 'msg-2' })).toBe(false)
    expect(isStoredDraftStale(draft, { latestInboundMessageId: null })).toBe(false)
  })
})
