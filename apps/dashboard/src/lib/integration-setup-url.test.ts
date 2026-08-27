import { describe, expect, it } from 'vitest'
import { moduleSetupPath, setupIntegrationHref } from './integration-setup-url'

describe('setupIntegrationHref', () => {
  it('opens the module page when a module slug is present', () => {
    expect(setupIntegrationHref({ module: 'accounting' })).toBe('/settings/modules/accounting')
    expect(setupIntegrationHref({ module: 'accounting', provider: 'moneybird' })).toBe(
      '/settings/modules/accounting?connect=moneybird',
    )
  })

  it('falls back to marketplace for a provider-only suggestion', () => {
    expect(setupIntegrationHref({ provider: 'github' })).toBe('/settings/marketplace?connect=github')
    expect(setupIntegrationHref({})).toBe('/settings/marketplace')
  })
})

describe('moduleSetupPath', () => {
  it('encodes the slug', () => {
    expect(moduleSetupPath('accounting')).toBe('/settings/modules/accounting')
  })
})
