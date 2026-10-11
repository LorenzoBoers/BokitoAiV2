import { describe, expect, it } from 'vitest'
import type { GatewayEvent } from './gateway'
import type { InboxThread, ThreadFilters } from './inbox-api'
import {
  extractLiveMessage,
  extractLiveThreadRow,
  threadMatchesFilters,
  upsertLiveMessage,
  upsertThreadRow,
} from './thread-live'
import type { InboxMessage } from './inbox-api'

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
    nextAt: null,
    endsAt: null,
    scheduleDetails: {},
    priority: 'normal',
    assignedToUserId: null,
    tags: [],
    lastMessageAt: '2026-08-19T10:00:00Z',
    lastMessagePreview: '',
    lastMessageDirection: 'inbound',
    hasUnread: true,
    isPinned: false,
    aiHandling: null,
    suggestedActions: [],
    createdAt: '2026-08-19T09:00:00Z',
    channel: 'email',
    folder: 'external',
    projectId: null,
    agentId: null,
    agentName: null,
    agentKind: null,
    ...overrides,
  } as InboxThread
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

  it('evaluates folder filters on the category and stage the row carries', () => {
    const ticket = {
      tagId: 'cat-1',
      name: 'repair',
      status: 'waiting' as const,
      projectId: null,
      stage: { key: 'parts', name: 'Waiting for parts', kind: 'waiting' as const },
    }
    const row = thread({ ticket })
    expect(threadMatchesFilters(row, { categoryId: 'cat-1' }, me)).toBe(true)
    expect(threadMatchesFilters(row, { categoryId: 'cat-2' }, me)).toBe(false)
    expect(threadMatchesFilters(row, { stage: 'waiting' }, me)).toBe(true)
    expect(threadMatchesFilters(row, { stage: 'parts' }, me)).toBe(true)
    expect(threadMatchesFilters(row, { stage: 'open' }, me)).toBe(false)
    expect(threadMatchesFilters(thread({ ticket: { ...ticket, status: 'proposed' } }), { categoryId: 'cat-1' }, me)).toBe(false)
    expect(threadMatchesFilters(thread({ ticket: undefined }), { categoryId: 'cat-1' }, me)).toBeNull()
    expect(threadMatchesFilters(row, { tag: 'repair' }, me)).toBe(true)
    expect(threadMatchesFilters(thread({ projectId: 'p1' }), { projectId: 'p1' }, me)).toBe(true)
    expect(threadMatchesFilters(thread({ projectId: null }), { projectId: 'p1' }, me)).toBe(false)
  })

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
      threadMatchesFilters(thread({ status: 'closed', nextAt: '2026-08-20T08:00:00Z' }), { view: 'scheduled' }, me),
    ).toBe(true)
    expect(threadMatchesFilters(thread({ status: 'open' }), { view: 'scheduled' }, me)).toBe(false)
  })

  it('resolves for_you / unassigned against the signed-in user', () => {
    expect(threadMatchesFilters(thread({ assignedToUserId: me }), { view: 'for_you' }, me)).toBe(true)
    // Team turns and mentions need the server: refetch instead of evicting.
    expect(threadMatchesFilters(thread({ assignedToUserId: 9 }), { view: 'for_you' }, me)).toBeNull()
    expect(threadMatchesFilters(thread(), { view: 'for_you' }, null)).toBeNull()
    expect(threadMatchesFilters(thread(), { view: 'unassigned' }, me)).toBe(true)
    expect(
      threadMatchesFilters(thread({ assignedToUserId: 9 }), { view: 'unassigned' }, me),
    ).toBe(false)
  })

  it('applies folder / channel / tag / assignee / connection filters', () => {
    expect(threadMatchesFilters(thread({ channel: 'whatsapp' }), { folder: 'external' }, me)).toBe(true)
    expect(threadMatchesFilters(thread({ channel: 'api' }), { folder: 'external' }, me)).toBe(true)
    expect(threadMatchesFilters(thread({ channel: 'internal' }), { folder: 'external' }, me)).toBe(false)
    expect(threadMatchesFilters(thread({ channel: 'internal' }), { folder: 'internal' }, me)).toBe(true)
    expect(threadMatchesFilters(thread({ channel: 'assistant' }), { folder: 'inbox' }, me)).toBe(true)
    expect(
      threadMatchesFilters(
        thread({ channel: 'assistant', source: 'personal' }),
        { folder: 'inbox' },
        me,
      ),
    ).toBe(false)
    expect(threadMatchesFilters(thread({ channel: 'internal' }), { folder: 'inbox' }, me)).toBe(false)
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
    const existing = thread({ agentId: 'a-1', agentName: 'Bokito', agentKind: 'company' })
    const incoming = thread({ emailSubject: 'Re: Order 42', hasUnread: true })
    const next = upsertThreadRow([existing], incoming)
    expect(next).toHaveLength(1)
    expect(next[0].emailSubject).toBe('Re: Order 42')
    expect(next[0].agentName).toBe('Bokito')
    expect(next[0].agentKind).toBe('company')
  })

  it('keeps AI handling when the live row carries none', () => {
    const handling = {
      effective: 'manual',
      requested: 'manual',
      source: 'conversation',
      sourceLabel: '',
      ceiling: 'autonomous',
      clampedBy: null,
      reason: 'assigned',
      untilClose: true,
      inherited: 'assisted',
      inheritedSource: 'channel',
      inheritedSourceLabel: 'Support',
      own: 'manual',
    } as const
    const existing = thread({ aiHandling: handling })
    const next = upsertThreadRow([existing], thread({ aiHandling: null }))
    expect(next[0].aiHandling?.effective).toBe('manual')
  })
})

describe('extractLiveThreadRow ai_handling', () => {
  it('normalizes the resolved payload', () => {
    const row = extractLiveThreadRow(
      gatewayEvent({
        thread: wireThreadRow({
          ai_handling: {
            effective: 'assisted',
            requested: 'autonomous',
            source: 'channel',
            ceiling: 'assisted',
            clamped_by: 'govern',
            inherited: 'autonomous',
            inherited_source: 'channel',
            own: null,
          },
        }),
      }),
    )
    expect(row?.aiHandling?.effective).toBe('assisted')
    expect(row?.aiHandling?.clampedBy).toBe('govern')
    expect(row?.aiHandling?.own).toBeNull()
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

describe('upsertLiveMessage', () => {
  it('updates send_status on an existing message id', () => {
    const scheduled = {
      id: 'msg-1',
      threadId: 'sig-1',
      kind: 'user_message',
      direction: 'outbound',
      bodyText: 'Hi Harold',
      sendStatus: 'scheduled' as const,
    } as InboxMessage
    const sent = { ...scheduled, sendStatus: 'sent' as const }
    const next = upsertLiveMessage([scheduled], sent)
    expect(next).toHaveLength(1)
    expect(next[0].sendStatus).toBe('sent')
    expect(next[0].bodyText).toBe('Hi Harold')
  })
})
