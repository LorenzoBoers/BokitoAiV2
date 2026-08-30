import { describe, expect, it } from 'vitest'
import { moduleIsOn, moduleStatusLabelKey, verbLabelKey } from './integration-modules'

describe('moduleIsOn', () => {
  it('prefers the explicit enabled flag', () => {
    expect(moduleIsOn({ status: 'available', enabled: true, tenant_status: 'not_installed' })).toBe(true)
    expect(moduleIsOn({ status: 'available', enabled: false, tenant_status: 'connected' })).toBe(false)
  })

  it('falls back to tenant status when the flag is missing', () => {
    expect(moduleIsOn({ status: 'available', tenant_status: 'on' })).toBe(true)
    expect(moduleIsOn({ status: 'available', tenant_status: 'connected' })).toBe(true)
    expect(moduleIsOn({ status: 'available', tenant_status: 'installed' })).toBe(true)
    expect(moduleIsOn({ status: 'available', tenant_status: 'not_installed' })).toBe(false)
  })

  it('treats setup as not installed for tools/nav', () => {
    expect(moduleIsOn({ status: 'available', install_state: 'setup', enabled: false })).toBe(false)
  })
})

describe('moduleStatusLabelKey', () => {
  it('keeps coming-soon ahead of enablement', () => {
    expect(
      moduleStatusLabelKey({ status: 'coming_soon', tenant_status: 'installed', enabled: true }),
    ).toBe('comingSoon')
  })

  it('distinguishes connected, installed, setup, and not installed', () => {
    expect(
      moduleStatusLabelKey({ status: 'available', tenant_status: 'connected', connected: true }),
    ).toBe('connectedBadge')
    expect(
      moduleStatusLabelKey({ status: 'available', enabled: true, tenant_status: 'installed' }),
    ).toBe('installedBadge')
    expect(
      moduleStatusLabelKey({ status: 'available', install_state: 'setup', tenant_status: 'setup' }),
    ).toBe('setupBadge')
    expect(
      moduleStatusLabelKey({ status: 'available', enabled: false, tenant_status: 'not_installed' }),
    ).toBe('notInstalledBadge')
  })
})

describe('verbLabelKey', () => {
  it('turns catalog labels into i18n fragments', () => {
    expect(verbLabelKey('Invoices and bills')).toBe('invoices_and_bills')
    expect(verbLabelKey('Chart of accounts')).toBe('chart_of_accounts')
  })
})
