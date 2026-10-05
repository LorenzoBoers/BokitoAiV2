import { describe, expect, it } from 'vitest'
import type { InboxThread } from './inbox-api'
import {
  customersFirst,
  pickPreferredInboxThread,
  resolveComposerSurface,
  threadCounterpartyName,
  threadHubPath,
  threadNeedsReply,
} from './message-composer'

function thread(overrides: Partial<InboxThread>): InboxThread {
  return {
    id: 't-1',
    organisationId: 'org-1',
    emailConnectionId: null,
    graphConversationId: '',
    emailSubject: 'WhatsApp 31612345678',
    contactId: 'c-1',
    contactEmail: '',
    contactName: '',
    contactPhone: '',
    status: 'open',
    snoozedUntil: null,
    followUpAt: null,
    followUpTitle: '',
    priority: 'normal',
    assignedToUserId: null,
    tags: [],
    lastMessageAt: null,
    hasUnread: false,
    isPinned: false,
    createdAt: '2026-08-24T10:00:00Z',
    ...overrides,
  } as InboxThread
}

describe('resolveComposerSurface (whatsapp)', () => {
  it('maps a whatsapp thread to the WhatsApp reply surface', () => {
    const surface = resolveComposerSurface(thread({ channel: 'whatsapp', contactName: 'Jan Jansen' }))
    expect(surface.channel).toBe('whatsapp')
    expect(surface.replyLabel).toBe('WhatsApp')
    expect(surface.includeSignature).toBe(false)
    expect(surface.modes).toEqual(['reply', 'ask', 'note'])
    expect(surface.replyPlaceholder).toContain('Jan Jansen')
    expect(surface.recipientValue).toBe('Jan Jansen')
  })

  it('exposes ask+note only on assistant threads', () => {
    const surface = resolveComposerSurface(
      thread({ channel: 'assistant', agentName: 'Bokito', folder: 'assistant' }),
    )
    expect(surface.channel).toBe('assistant')
    expect(surface.modes).toEqual(['ask', 'note'])
    expect(surface.defaultMode).toBe('ask')
  })

  it('exposes ask+note only on agent-run threads', () => {
    const surface = resolveComposerSurface(
      thread({ channel: 'internal', folder: 'internal', agentName: 'Ops' }),
    )
    expect(surface.channel).toBe('internal')
    expect(surface.modes).toEqual(['ask', 'note'])
    expect(surface.defaultMode).toBe('ask')
  })

  it('humanizes generic website visitor names in chat placeholders', () => {
    const surface = resolveComposerSurface(
      thread({ channel: 'widget', contactName: 'Website visitor', contactEmail: 'visitor@web' }),
      { visitor: 'Websitebezoeker' },
    )
    expect(surface.channel).toBe('chat')
    expect(surface.replyPlaceholderParams?.name).toBe('Websitebezoeker')
    expect(surface.replyPlaceholder).toContain('Websitebezoeker')
  })

  it('falls back to a generic recipient without a contact name', () => {
    const surface = resolveComposerSurface(thread({ channel: 'whatsapp' }))
    expect(surface.channel).toBe('whatsapp')
    expect(surface.recipientValue).toBe('WhatsApp contact')
    expect(surface.showRecipient).toBe(false)
  })

  it('prefers an unread customer thread over internal agent work', () => {
    const preferred = pickPreferredInboxThread([
      thread({ id: 'internal-1', channel: 'internal', folder: 'internal', hasUnread: true, emailSubject: 'Daily scan' }),
      thread({ id: 'customer-1', channel: 'email', folder: 'customer', hasUnread: false, contactName: 'Sanne' }),
      thread({ id: 'customer-2', channel: 'email', folder: 'customer', hasUnread: true, contactName: 'Erik' }),
    ])
    expect(preferred?.id).toBe('customer-2')
  })

  it('keeps customer threads above internal agent work', () => {
    const ordered = customersFirst([
      thread({ id: 'internal-1', channel: 'internal', folder: 'internal' }),
      thread({ id: 'customer-1', channel: 'email', folder: 'customer' }),
    ])
    expect(ordered.map((item) => item.id)).toEqual(['customer-1', 'internal-1'])
  })

  it('opens customer threads in Open, assistant chats under the agent chip, runs in All', () => {
    expect(threadHubPath(thread({ id: 'c1', channel: 'email', folder: 'customer' }))).toBe(
      '/communication/inbox/open/t/c1',
    )
    expect(
      threadHubPath(thread({ id: 'a1', channel: 'assistant', folder: 'assistant', agentId: 'agent-9' })),
    ).toBe('/communication/agent/agent-9/t/a1')
    expect(threadHubPath(thread({ id: 'i1', channel: 'internal', folder: 'internal' }))).toBe(
      '/communication/inbox/all/t/i1',
    )
  })

  it('falls back to the first internal thread when the list is only agent work', () => {
    const preferred = pickPreferredInboxThread([
      thread({ id: 'internal-1', channel: 'internal', folder: 'internal' }),
    ])
    expect(preferred?.id).toBe('internal-1')
  })

  it('flags open unread or last-inbound threads as needing a reply', () => {
    expect(threadNeedsReply(thread({ status: 'open', hasUnread: true, lastMessageDirection: 'outbound' }))).toBe(true)
    expect(threadNeedsReply(thread({ status: 'open', hasUnread: false, lastMessageDirection: 'inbound' }))).toBe(true)
    expect(threadNeedsReply(thread({ status: 'open', hasUnread: false, lastMessageDirection: 'outbound' }))).toBe(false)
    expect(threadNeedsReply(thread({ status: 'closed', hasUnread: true, lastMessageDirection: 'inbound' }))).toBe(false)
    expect(threadNeedsReply(thread({ status: 'pending', hasUnread: false, lastMessageDirection: 'inbound' }))).toBe(false)
  })

  it('keeps email threads on the email surface', () => {
    const surface = resolveComposerSurface(
      thread({ channel: 'email', contactEmail: 'klant@example.com' }),
    )
    expect(surface.channel).toBe('email')
    expect(surface.includeSignature).toBe(true)
    expect(surface.defaultMode).toBe('reply')
  })

  it('defaults noreply addresses to an internal note, not Reply to', () => {
    const surface = resolveComposerSurface(
      thread({ channel: 'email', contactEmail: 'donotreply@broker.example', contactName: 'Broker' }),
    )
    expect(surface.channel).toBe('email')
    expect(surface.defaultMode).toBe('note')
    expect(surface.showRecipient).toBe(false)
  })

  it('defaults internal threads with an open decision to a neutral note', () => {
    const surface = resolveComposerSurface(
      thread({
        channel: 'internal',
        folder: 'internal',
        agentName: 'Platform PO',
        hasOpenDecision: true,
      }),
    )
    expect(surface.channel).toBe('internal')
    expect(surface.defaultMode).toBe('note')
    expect(surface.showRecipient).toBe(false)
  })

  it('keeps website chat on chat even when the visitor left an email', () => {
    const surface = resolveComposerSurface(
      thread({
        channel: 'widget',
        contactEmail: 'sanne@klant.nl',
        contactName: 'Sanne de Vries',
      }),
    )
    expect(surface.channel).toBe('chat')
    expect(surface.includeSignature).toBe(false)
  })

  it('defaults a team room to an internal note, not ask-agent', () => {
    const surface = resolveComposerSurface(
      thread({
        channel: 'internal',
        folder: 'internal',
        owner: { kind: 'team', userId: null, agentId: null, teamId: 'tm-1' },
        contactName: 'Sjaakies',
        agentName: 'Platform PO',
      }),
    )
    expect(surface.defaultMode).toBe('note')
    expect(surface.showRecipient).toBe(false)
    expect(threadCounterpartyName(thread({
      channel: 'internal',
      folder: 'internal',
      owner: { kind: 'team', userId: null, agentId: null, teamId: 'tm-1' },
      contactName: 'Sjaakies',
      agentName: 'Platform PO',
    }))).toBe('Sjaakies')
  })

  it('treats live-chat aliases as chat', () => {
    expect(resolveComposerSurface(thread({ channel: 'webchat' })).channel).toBe('chat')
    expect(resolveComposerSurface(thread({ channel: 'livechat' })).channel).toBe('chat')
  })
})
