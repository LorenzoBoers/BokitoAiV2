import { describe, expect, it } from 'vitest'
import type { InboxThread } from './inbox-api'
import {
  customersFirst,
  customersOnly,
  pickPreferredInboxThread,
  resolveComposerSurface,
  threadHubPath,
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
    expect(surface.tabs).toEqual(['reply', 'note'])
    expect(surface.replyPlaceholder).toContain('Jan Jansen')
    expect(surface.recipientValue).toBe('Jan Jansen')
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

  it('hides internal agent work from the Open queue', () => {
    const open = customersOnly([
      thread({ id: 'internal-1', channel: 'internal', folder: 'internal' }),
      thread({ id: 'customer-1', channel: 'email', folder: 'customer' }),
    ])
    expect(open.map((item) => item.id)).toEqual(['customer-1'])
  })

  it('opens customer threads in Open and agent work in Agent-runs', () => {
    expect(threadHubPath(thread({ id: 'c1', channel: 'email', folder: 'customer' }))).toBe(
      '/communication/inbox/open/t/c1',
    )
    expect(threadHubPath(thread({ id: 'i1', channel: 'internal', folder: 'internal' }))).toBe(
      '/communication/runs/all/t/i1',
    )
  })

  it('falls back to the first internal thread when the list is only agent work', () => {
    const preferred = pickPreferredInboxThread([
      thread({ id: 'internal-1', channel: 'internal', folder: 'internal' }),
    ])
    expect(preferred?.id).toBe('internal-1')
  })

  it('keeps email threads on the email surface', () => {
    const surface = resolveComposerSurface(
      thread({ channel: 'email', contactEmail: 'klant@example.com' }),
    )
    expect(surface.channel).toBe('email')
    expect(surface.includeSignature).toBe(true)
  })
})
