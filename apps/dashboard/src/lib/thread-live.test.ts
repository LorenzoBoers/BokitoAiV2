import { describe, expect, it } from 'vitest'
import type { GatewayEvent } from './gateway'
import type { InboxThread, ThreadFilters } from './inbox-api'
import {
  extractLiveMessage,
  extractLiveThreadRow,
  threadMatchesFilters,
  upsertThreadRow,
} from './thread-live'

function thread(overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id: 'sig-1',
    organisationId: 'org-1',
    emailConnectionId: null,
    graphConversationId: '',
    emailSubject: 'Order 42',
    contactId: null,
    contactEmail: 'k@x.nl',
    contactName: 'Klant',
    contactPhone: '',
    status: 'open',
    snoozedUntil: null,
    priority: 'normal',
    assignedToUserId: null,
    tags: [],
    lastMessageAt: '2026-08-19T10:00:00Z',
    lastMessagePreview: '',
    lastMessageDirection: 'inbound',
    hasUnread: true,
    isPinned: false,
    aiPaused: false,
    suggestedActions: [],
    createdAt: '2026-08-19T09:00:00Z',
    channel: 'email',
    folder: 'external',
    projectId: null,
    agentId: null,
    agentName: null,
    agentKind: null,
    ...overrides,
  }
}

function gatewayEvent(data: Record<string, unknown>, event = 'message'): GatewayEvent {
  return { event, topics: ['threads'], data }
}

/** Wire-shape thread row as the gateway now publishes it (serialize_thread). */
function wireThreadRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sig-1',
    organisation_id: 'org-1',
    email_connection_id: null,
    graph_conversation_id: '',
    email_subject: 'Order 42',
    contact_email: 'k@x.nl',
    contact_name: 'Klant',
    status: 'open',
    priority: 'normal',
    assigned_to_user_id: null,
    tags: [],
    last_message_at: '2026-08-19T10:00:00Z',
    has_unread: true,
    channel: 'email',
    folder: 'external',
    created_at: '2026-08-19T09:00:00Z',
    ...overrides,
  }
}

describe('threadMatchesFilters', () => {
  const me = 7

  it('applies view predicates that mirror the server', () => {
    const open = thread()
    expect(threadMatchesFilters(open, { view: 'all' }, me)).toBe(true)
    expect(threadMatchesFilters(thread({ status: 'closed' }), { view: 'all' }, me)).toBe(false)
    expect(threadMatchesFilters(thread({ status: 'spam' }), { view: 'all' }, me)).toBe(false)
    expect(threadMatchesFilters(open, { view: 'all_open' }, me)).toBe(true)
    expect(threadMatchesFilters(thread({ status: 'closed' }), { view: 'all_open' }, me)).toBe(false)
    expect(threadMatchesFilters(thread({ status: 'closed' }), { view: 'closed' }, me)).toBe(true)
    expect(threadMatchesFilters(thread({ status: 'spam' }), { view: 'spam' }, me)).toBe(true)
    expect(threadMatchesFilters(thread({ status: 'pending' }), { view: 'pending' }, me)).toBe(true)
    expect(
      threadMatchesFilters(
        thread({ status: 'pending', snoozedUntil: '2026-08-20T08:00:00Z' }),
        { view: 'snoozed' },
        me,
      ),
    ).toBe(true)
    expect(threadMatchesFilters(thread({ status: 'pending' }), { view: 'snoozed' }, me)).toBe(true)
  })

  it('resolves mine / unassigned against the signed-in user', () => {
    expect(threadMatchesFilters(thread({ assignedToUserId: me }), { view: 'mine' }, me)).toBe(true)
    expect(threadMatchesFilters(thread({ assignedToUserId: 9 }), { view: 'mine' }, me)).toBe(false)
    expect(threadMatchesFilters(thread(), { view: 'mine' }, null)).toBeNull()
    expect(threadMatchesFilters(thread(), { view: 'unassigned' }, me)).toBe(true)
    expect(
      threadMatchesFilters(thread({ assignedToUserId: 9 }), { view: 'unassigned' }, me),
    ).toBe(false)
  })

  it('applies folder / channel / tag / assignee / connection filters', () => {
    expect(threadMatchesFilters(thread(), { folder: 'external' }, me)).toBe(true)
    expect(threadMatchesFilters(thread({ channel: 'internal' }), { folder: 'external' }, me)).toBe(false)
    expect(threadMatchesFilters(thread({ channel: 'internal' }), { folder: 'internal' }, me)).toBe(true)
    expect(threadMatchesFilters(thread({ channel: 'assistant' }), { folder: 'inbox' }, me)).toBe(false)
    expect(threadMatchesFilters(thread(), { channel: 'widget' }, me)).toBe(false)
    expect(threadMatchesFilters(thread({ tags: ['vip'] }), { tag: 'vip' }, me)).toBe(true)
    expect(threadMatchesFilters(thread(), { tag: 'vip' }, me)).toBe(false)
    expect(threadMatchesFilters(thread({ assignedToUserId: 3 }), { assigneeId: 3 }, me)).toBe(true)
    expect(threadMatchesFilters(thread(), { assigneeId: 3 }, me)).toBe(false)
    expect(
      threadMatchesFilters(thread({ emailConnectionId: 12 }), { connectionId: 12 }, me),
    ).toBe(true)
    expect(threadMatchesFilters(thread(), { connectionId: 12 }, me)).toBe(false)
  })

  it('ANDs unread / needs-reply / pinned flags on top of the view', () => {
    expect(threadMatchesFilters(thread({ hasUnread: false }), { view: 'all_open', unread: true }, me)).toBe(false)
    expect(threadMatchesFilters(thread({ hasUnread: true }), { view: 'all_open', unread: true }, me)).toBe(true)
    expect(
      threadMatchesFilters(
        thread({ hasUnread: false, lastMessageDirection: 'outbound', status: 'open' }),
        { view: 'all_open', needsReply: true },
        me,
      ),
    ).toBe(false)
    expect(
      threadMatchesFilters(
        thread({ hasUnread: false, lastMessageDirection: 'inbound', status: 'open' }),
        { view: 'all_open', needsReply: true },
        me,
      ),
    ).toBe(true)
    expect(threadMatchesFilters(thread({ isPinned: false }), { view: 'all_open', pinnedOnly: true }, me)).toBe(false)
    expect(threadMatchesFilters(thread({ isPinned: true }), { view: 'all_open', pinnedOnly: true }, me)).toBe(true)
    expect(
      threadMatchesFilters(thread({ hasOpenDecision: false }), { view: 'all_open', needsDecision: true }, me),
    ).toBe(false)
    expect(
      threadMatchesFilters(thread({ hasOpenDecision: true }), { view: 'all_open', needsDecision: true }, me),
    ).toBe(true)
  })

  it('falls back (null) for predicates that need the server', () => {
    const filtersNeedingServer: ThreadFilters[] = [
      { search: 'factuur' },
      { view: 'awaiting_decision' },
      { view: 'pinned' },
      { view: 'updates' },
      { view: 'results' },
      { view: 'outbound' },
      { folder: 'assistant' },
    ]
    for (const filters of filtersNeedingServer) {
      expect(threadMatchesFilters(thread(), filters, me)).toBeNull()
    }
  })
})

describe('upsertThreadRow', () => {
  it('prepends unknown threads', () => {
    const existing = thread({ id: 'sig-1' })
    const incoming = thread({ id: 'sig-2' })
    const next = upsertThreadRow([existing], incoming)
    expect(next.map((t) => t.id)).toEqual(['sig-2', 'sig-1'])
  })

  it('replaces known threads in place and keeps agent enrichment', () => {
    const existing = thread({ agentId: 'a-1', agentName: 'Bokito', agentKind: 'personal' })
    const incoming = thread({ emailSubject: 'Re: Order 42', hasUnread: true })
    const next = upsertThreadRow([existing], incoming)
    expect(next).toHaveLength(1)
    expect(next[0].emailSubject).toBe('Re: Order 42')
    expect(next[0].agentName).toBe('Bokito')
    expect(next[0].agentKind).toBe('personal')
  })
})

describe('extractLiveThreadRow', () => {
  it('normalizes the canonical row shape', () => {
    const row = extractLiveThreadRow(gatewayEvent({ thread: wireThreadRow() }))
    expect(row).not.toBeNull()
    expect(row?.id).toBe('sig-1')
    expect(row?.emailSubject).toBe('Order 42')
    expect(row?.status).toBe('open')
  })

  it('rejects the legacy summary shape so callers refetch', () => {
    const legacy = { signal_id: 'sig-1', channel: 'email', subject: 'Order 42', status: 'open' }
    expect(extractLiveThreadRow(gatewayEvent({ thread: legacy }))).toBeNull()
    expect(extractLiveThreadRow(gatewayEvent({}))).toBeNull()
  })
})

describe('extractLiveMessage', () => {
  const fullMessage = {
    id: 'msg-1',
    thread_id: 'sig-1',
    signal_id: 'sig-1',
    kind: 'user_message',
    direction: 'inbound',
    body_preview: 'Waar blijft mijn order?',
    body_text: 'Waar blijft mijn order?',
    created_at: '2026-08-19T10:00:00Z',
  }

  it('normalizes the full serialized message', () => {
    const msg = extractLiveMessage(gatewayEvent({ message: fullMessage }))
    expect(msg).not.toBeNull()
    expect(msg?.id).toBe('msg-1')
    expect(msg?.threadId).toBe('sig-1')
    expect(msg?.bodyText).toBe('Waar blijft mijn order?')
  })

  it('rejects the threads-topic preview (no body_text) so callers refetch', () => {
    const preview = {
      id: 'msg-1',
      signal_id: 'sig-1',
      kind: 'user_message',
      direction: 'inbound',
      body_preview: 'Waar blijft mijn order?',
      created_at: '2026-08-19T10:00:00Z',
    }
    expect(extractLiveMessage(gatewayEvent({ message: preview }))).toBeNull()
  })

  it('ignores non-message events', () => {
    expect(extractLiveMessage(gatewayEvent({ message: fullMessage }, 'thread'))).toBeNull()
  })
})
