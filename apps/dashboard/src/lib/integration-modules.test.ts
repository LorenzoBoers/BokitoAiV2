import { describe, expect, it } from 'vitest'
import { moduleIsOn, moduleStatusLabelKey, verbLabelKey } from './integration-modules'

describe('moduleIsOn', () => {
  it('prefers the explicit enabled flag', () => {
    expect(moduleIsOn({ enabled: true, tenant_status: 'off' })).toBe(true)
    expect(moduleIsOn({ enabled: false, tenant_status: 'connected' })).toBe(false)
  })

  it('falls back to tenant status when the flag is missing', () => {
    expect(moduleIsOn({ tenant_status: 'on' })).toBe(true)
    expect(moduleIsOn({ tenant_status: 'connected' })).toBe(true)
    expect(moduleIsOn({ tenant_status: 'off' })).toBe(false)
  })
})

describe('moduleStatusLabelKey', () => {
  it('keeps coming-soon ahead of enablement', () => {
    expect(
      moduleStatusLabelKey({ status: 'coming_soon', tenant_status: 'on', enabled: true }),
    ).toBe('comingSoon')
  })

  it('distinguishes connected, on, and off', () => {
    expect(
      moduleStatusLabelKey({ status: 'available', tenant_status: 'connected', connected: true }),
    ).toBe('connectedBadge')
    expect(moduleStatusLabelKey({ status: 'available', enabled: true, tenant_status: 'on' })).toBe(
      'onBadge',
    )
    expect(moduleStatusLabelKey({ status: 'available', enabled: false, tenant_status: 'off' })).toBe(
      'offBadge',
    )
  })
})

describe('verbLabelKey', () => {
  it('turns catalog labels into i18n fragments', () => {
    expect(verbLabelKey('Invoices and bills')).toBe('invoices_and_bills')
    expect(verbLabelKey('Chart of accounts')).toBe('chart_of_accounts')
  })
})
