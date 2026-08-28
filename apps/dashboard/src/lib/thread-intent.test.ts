import { describe, expect, it } from 'vitest'
import { suggestedBillingTag, threadLooksFinancial } from './thread-intent'

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

describe('suggestedBillingTag', () => {
  it('offers billing once, in either language', () => {
    expect(suggestedBillingTag([])).toBe('billing')
    expect(suggestedBillingTag(['vip'])).toBe('billing')
    expect(suggestedBillingTag(['billing'])).toBe(null)
    expect(suggestedBillingTag(['Facturatie'])).toBe(null)
  })
})
