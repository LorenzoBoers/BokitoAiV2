import { describe, expect, it } from 'vitest'
import {
  inboundQuoteText,
  suggestedBillingTag,
  suggestedReplyAllRecipients,
  threadLooksFinancial,
} from './thread-intent'

describe('threadLooksFinancial', () => {
  it('matches invoice language in EN and NL', () => {
    expect(threadLooksFinancial('Vraag over facturatie', 'Klopt het bedrag?')).toBe(true)
    expect(threadLooksFinancial('Invoice 4821', null)).toBe(true)
    expect(threadLooksFinancial('Offerte voor onboarding', '')).toBe(true)
    expect(threadLooksFinancial('Aanmaning 12', 'Betalingsherinnering')).toBe(true)
  })

  it('ignores unrelated subjects', () => {
    expect(threadLooksFinancial('Kan ik een demo krijgen?', null)).toBe(false)
    expect(threadLooksFinancial(null, null)).toBe(false)
  })
})

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

describe('suggestedBillingTag', () => {
  it('offers billing once, in either language', () => {
    expect(suggestedBillingTag([])).toBe('billing')
    expect(suggestedBillingTag(['vip'])).toBe('billing')
    expect(suggestedBillingTag(['billing'])).toBe(null)
    expect(suggestedBillingTag(['Facturatie'])).toBe(null)
  })
})
