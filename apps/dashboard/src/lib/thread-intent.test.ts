import { describe, expect, it } from 'vitest'
import { inboundQuoteText, suggestedReplyAllRecipients } from './thread-intent'

describe('inboundQuoteText', () => {
  it('prefers body text, then preview, then stripped HTML', () => {
    expect(inboundQuoteText({ bodyText: '  Hello  ', bodyPreview: 'prev', bodyHtml: '<p>x</p>' })).toBe(
      'Hello',
    )
    expect(inboundQuoteText({ bodyText: '', bodyPreview: 'Short preview', bodyHtml: '<p>x</p>' })).toBe(
      'Short preview',
    )
    expect(
      inboundQuoteText({
        bodyText: '   ',
        bodyPreview: '',
        bodyHtml: '<p>Can you help?<br/>Thanks</p>',
      }),
    ).toBe('Can you help?\nThanks')
  })
})

describe('suggestedReplyAllRecipients', () => {
  it('keeps other To and CC addresses and drops our mailbox', () => {
    expect(
      suggestedReplyAllRecipients({
        cc: 'finance@acme.com, boss@acme.com',
        toAddresses: '["us@bokito.ai","colleague@acme.com"]',
        exclude: ['us@bokito.ai', 'customer@acme.com'],
      }),
    ).toBe('finance@acme.com, boss@acme.com, colleague@acme.com')
  })
})