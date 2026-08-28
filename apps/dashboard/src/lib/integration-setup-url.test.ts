import { describe, expect, it } from 'vitest'
import { isModuleSetupAction, moduleSetupPath, setupIntegrationHref } from './integration-setup-url'

describe('setupIntegrationHref', () => {
  it('opens the module page when a module slug is present', () => {
    expect(setupIntegrationHref({ module: 'accounting' })).toBe('/settings/modules/accounting')
    expect(setupIntegrationHref({ module: 'accounting', provider: 'moneybird' })).toBe(
      '/settings/modules/accounting?connect=moneybird&step=setup',
    )
  })

  it('falls back to marketplace for a provider-only suggestion', () => {
    expect(setupIntegrationHref({ provider: 'github' })).toBe('/settings/marketplace?connect=github')
    expect(setupIntegrationHref({})).toBe('/settings/marketplace')
  })
})

describe('isModuleSetupAction', () => {
  it('treats enable and connect as module navigation', () => {
    expect(isModuleSetupAction('enable_module')).toBe(true)
    expect(isModuleSetupAction('setup_integration')).toBe(true)
    expect(isModuleSetupAction('approve')).toBe(false)
  })
})

describe('moduleSetupPath', () => {
  it('encodes the slug', () => {
    expect(moduleSetupPath('accounting')).toBe('/settings/modules/accounting')
  })

  it('opens the connect step for a package', () => {
    expect(moduleSetupPath('accounting', 'moneybird', 'setup')).toBe(
      '/settings/modules/accounting?connect=moneybird&step=setup',
    )
  })
})
