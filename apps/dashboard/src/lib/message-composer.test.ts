import { describe, expect, it } from 'vitest'
import type { InboxThread } from './inbox-api'
import { resolveComposerSurface } from './message-composer'

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

  it('keeps email threads on the email surface', () => {
    const surface = resolveComposerSurface(
      thread({ channel: 'email', contactEmail: 'klant@example.com' }),
    )
    expect(surface.channel).toBe('email')
    expect(surface.includeSignature).toBe(true)
  })
})
