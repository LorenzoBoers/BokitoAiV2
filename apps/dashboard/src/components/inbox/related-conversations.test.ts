import { describe, expect, it } from 'vitest'
import type { InboxThread, RelatedConversation } from '../../lib/inbox-api'
import { otherConversations } from './ContactPanel'
import { pickRelatedConversation } from './RelatedConversationBanner'

const NOW = Date.parse('2026-10-06T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString()

function related(partial: Partial<RelatedConversation> & { id: string }): RelatedConversation {
  return {
    channel: 'whatsapp',
    subject: '',
    status: 'open',
    lastMessageAt: hoursAgo(1),
    lastMessageDirection: 'inbound',
    lastMessagePreview: '',
    hasOpenProposal: false,
    ...partial,
  }
}

function thread(partial: Partial<InboxThread> & { id: string }): InboxThread {
  return {
    channel: 'email',
    status: 'closed',
    hasUnread: false,
    emailSubject: 'Older mail',
    lastMessageAt: hoursAgo(48),
    ...partial,
  } as InboxThread
}

describe('pickRelatedConversation', () => {
  it('returns the newest conversation with activity in the last week', () => {
    const rows = [
      related({ id: 'a', lastMessageAt: hoursAgo(30) }),
      related({ id: 'b', lastMessageAt: hoursAgo(2) }),
      related({ id: 'c', lastMessageAt: hoursAgo(24 * 10) }),
    ]
    expect(pickRelatedConversation(rows, NOW)?.id).toBe('b')
  })

  it('returns null without recent activity', () => {
    expect(pickRelatedConversation(undefined, NOW)).toBeNull()
    expect(pickRelatedConversation([], NOW)).toBeNull()
    expect(pickRelatedConversation([related({ id: 'old', lastMessageAt: hoursAgo(24 * 8) })], NOW)).toBeNull()
    expect(pickRelatedConversation([related({ id: 'none', lastMessageAt: null })], NOW)).toBeNull()
  })
})

describe('otherConversations', () => {
  it('merges contact-book threads with payload siblings, drops the current one, open first', () => {
    const threads = [
      thread({ id: 'current', status: 'open' }),
      thread({ id: 'closed-mail', status: 'closed', lastMessageAt: hoursAgo(5) }),
      thread({ id: 'open-mail', status: 'open', lastMessageAt: hoursAgo(72) }),
    ]
    const siblings = [
      related({ id: 'wa', channel: 'whatsapp', status: 'open', lastMessageAt: hoursAgo(1), hasOpenProposal: true }),
      related({ id: 'closed-mail', channel: 'email', status: 'closed', hasOpenProposal: false }),
    ]
    const rows = otherConversations(threads, siblings, 'current')
    expect(rows.map((row) => row.id)).toEqual(['wa', 'open-mail', 'closed-mail'])
    expect(rows[0].hasOpenProposal).toBe(true)
    expect(rows[0].channel).toBe('whatsapp')
    // Payload rows enrich (not duplicate) contact-book rows.
    expect(rows.filter((row) => row.id === 'closed-mail')).toHaveLength(1)
  })

  it('works without payload rows', () => {
    const rows = otherConversations([thread({ id: 'x', status: 'pending' })], undefined, null)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('pending')
  })
})
