import { describe, expect, it } from 'vitest'
import { isPlatformSignalTypeSlug, signalTypeLabel } from './signal-type-catalog'

describe('signalTypeLabel', () => {
  it('maps platform slugs to NL and EN labels', () => {
    expect(signalTypeLabel({ slug: 'invoice_payment', name: 'Factuur/betaling' }, 'nl')).toBe(
      'Factuur/betaling',
    )
    expect(signalTypeLabel({ slug: 'invoice_payment', name: 'Factuur/betaling' }, 'en')).toBe(
      'Invoice / payment',
    )
    expect(signalTypeLabel({ slug: 'complaint', name: 'Complaint' }, 'nl')).toBe('Klacht')
    expect(signalTypeLabel({ slug: 'bug_report', name: 'Storing' }, 'en')).toBe('Bug report')
  })

  it('keeps operator-customized names', () => {
    expect(
      signalTypeLabel({ slug: 'complaint', name: 'Klachten VIP-klanten' }, 'nl'),
    ).toBe('Klachten VIP-klanten')
  })

  it('falls back to the API name for unknown types', () => {
    expect(signalTypeLabel({ slug: 'custom_refund', name: 'Terugbetaling' }, 'en')).toBe(
      'Terugbetaling',
    )
  })
})

describe('isPlatformSignalTypeSlug', () => {
  it('recognizes seeded slugs', () => {
    expect(isPlatformSignalTypeSlug('invoice_payment')).toBe(true)
    expect(isPlatformSignalTypeSlug('custom_refund')).toBe(false)
  })
})
