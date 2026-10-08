import { describe, expect, it } from 'vitest'
import {
  buildMailDraftIntent,
  buildQuotedHtml,
  canReplyAll,
  forwardSubject,
  parseAddressList,
  replySubject,
} from './mail-reply'
import type { InboxMessage } from './inbox-api'

function msg(overrides: Partial<InboxMessage> = {}): InboxMessage {
  return {
    id: 'm1',
    threadId: 't1',
    connectionId: null,
    direction: 'inbound',
    fromAddress: 'harold@bourgondienadvies.nl',
    toAddresses: '',
    toHeader: 'me@firm.nl, collega@firm.nl',
    cc: 'cc1@x.nl',
    subject: 'vba en whatsapp',
    bodyPreview: 'Ha Lorenzo',
    bodyText: 'Ha Lorenzo, mijn whatsapp doet het niet meer.',
    bodyHtml: '<p>Ha Lorenzo</p>',
    graphMessageId: '',
    inReplyTo: null,
    authorUserId: null,
    isRead: true,
    sendStatus: null,
    attachments: null,
    receivedAt: '2026-10-07T07:45:53Z',
    createdAt: '2026-10-07T07:45:53Z',
    ...overrides,
  } as InboxMessage
}

describe('mail-reply', () => {
  it('parses name-addr and bare headers', () => {
    expect(parseAddressList('Harold <h@x.nl>, b@y.nl')).toEqual(['h@x.nl', 'b@y.nl'])
    expect(parseAddressList('')).toEqual([])
  })

  it('builds subjects', () => {
    expect(replySubject('vba')).toBe('Re: vba')
    expect(replySubject('Re: vba')).toBe('Re: vba')
    expect(forwardSubject('Re: vba')).toBe('Fwd: vba')
    expect(forwardSubject('Fwd: vba')).toBe('Fwd: vba')
  })

  it('reply targets the sender only', () => {
    const intent = buildMailDraftIntent(msg(), 'reply', { ownAddresses: ['me@firm.nl'] })
    expect(intent.to).toBe('harold@bourgondienadvies.nl')
    expect(intent.cc).toBe('')
    expect(intent.subject).toBe('Re: vba en whatsapp')
  })

  it('reply-all unions to/cc minus own mailbox', () => {
    const intent = buildMailDraftIntent(msg(), 'reply_all', { ownAddresses: ['me@firm.nl'] })
    expect(intent.to).toBe('harold@bourgondienadvies.nl, collega@firm.nl')
    expect(intent.cc).toBe('cc1@x.nl')
  })

  it('forward empties recipients and prefixes Fwd', () => {
    const intent = buildMailDraftIntent(msg(), 'forward', { ownAddresses: ['me@firm.nl'] })
    expect(intent.to).toBe('')
    expect(intent.subject).toBe('Fwd: vba en whatsapp')
    expect(intent.quotedHtml).toContain('Ha Lorenzo')
  })

  it('canReplyAll is false for single-recipient mail', () => {
    expect(canReplyAll(msg({ toHeader: 'me@firm.nl', cc: null }), ['me@firm.nl'])).toBe(false)
    expect(canReplyAll(msg(), ['me@firm.nl'])).toBe(true)
  })

  it('quoted block carries headers and body', () => {
    const html = buildQuotedHtml(msg(), { language: 'nl', senderName: 'Harold' })
    expect(html).toContain('Van:')
    expect(html).toContain('harold@bourgondienadvies.nl')
    expect(html).toContain('Onderwerp:')
    expect(html).toContain('<p>Ha Lorenzo</p>')
  })

  it('reply on own outbound mail keeps its recipients', () => {
    const intent = buildMailDraftIntent(
      msg({ direction: 'outbound', fromAddress: 'me@firm.nl', toAddresses: 'klant@x.nl' }),
      'reply',
      { ownAddresses: ['me@firm.nl'] },
    )
    expect(intent.to).toBe('klant@x.nl')
  })
})
