import { describe, expect, it } from 'vitest'
import {
  isModuleSetupAction,
  moduleSetupPath,
  moduleSlugFromPathname,
  setupIntegrationHref,
} from './integration-setup-url'

describe('setupIntegrationHref', () => {
  it('opens the module page when a module slug is present', () => {
    expect(setupIntegrationHref({ module: 'accounting' })).toBe('/connections/accounting')
    expect(setupIntegrationHref({ module: 'accounting', provider: 'moneybird' })).toBe(
      '/connections/accounting?connect=moneybird&step=setup',
    )
  })

  it('falls back to marketplace for a provider-only suggestion', () => {
    expect(setupIntegrationHref({ provider: 'github' })).toBe('/connections/marketplace?connect=github')
    expect(setupIntegrationHref({})).toBe('/connections/marketplace')
  })
})

describe('isModuleSetupAction', () => {
  it('treats enable and connect as module navigation', () => {
    expect(isModuleSetupAction('enable_module')).toBe(true)
    expect(isModuleSetupAction('setup_integration')).toBe(true)
    expect(isModuleSetupAction('approve')).toBe(false)
  })
})

describe('moduleSlugFromPathname', () => {
  it('reads a module home and ignores hub tabs', () => {
    expect(moduleSlugFromPathname('/connections/accounting')).toBe('accounting')
    expect(moduleSlugFromPathname('/connections/connected')).toBeNull()
    expect(moduleSlugFromPathname('/connections/marketplace')).toBeNull()
    // OAuth returns minted on the hub's former root still resolve.
    expect(moduleSlugFromPathname('/modules/accounting')).toBe('accounting')
  })
})

describe('moduleSetupPath', () => {
  it('encodes the slug', () => {
    expect(moduleSetupPath('accounting')).toBe('/connections/accounting')
  })

  it('opens the connect step for a package', () => {
    expect(moduleSetupPath('accounting', 'moneybird', 'setup')).toBe(
      '/connections/accounting?connect=moneybird&step=setup',
    )
  })

  it('supports tab deep-links', () => {
    expect(moduleSetupPath('accounting', null, undefined, 'sources')).toBe(
      '/connections/accounting?tab=sources',
    )
  })
})
