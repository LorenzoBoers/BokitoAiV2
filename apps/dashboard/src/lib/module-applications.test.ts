import { describe, expect, it } from 'vitest'
import {
  applicationsForModule,
  moduleUsesApplication,
  modulesForApplication,
} from './module-applications'
import type { IntegrationApplication } from './integration-applications'
import type { IntegrationModuleRow } from './integrations-api'

function app(hostSlug: string, module: string | null, providerSlugs: string[]) {
  return {
    hostSlug,
    module,
    offers: providerSlugs.map((slug) => ({
      integration: { id: slug },
      provider: { slug },
    })),
  } as unknown as IntegrationApplication
}

function moduleRow(slug: string, providerSlugs: string[]) {
  return { slug, provider_slugs: providerSlugs } as unknown as IntegrationModuleRow
}

const accounting = moduleRow('accounting', ['moneybird', 'king_accountancy'])
const banking = moduleRow('banking', [])

const moneybird = app('moneybird', 'accounting', ['moneybird'])
const king = app('king', null, ['king_accountancy'])
const notion = app('notion', null, ['notion'])

describe('moduleUsesApplication', () => {
  it('matches on the catalog module tag', () => {
    expect(moduleUsesApplication(accounting, moneybird)).toBe(true)
  })

  it('matches on a shared provider slug without a module tag', () => {
    expect(moduleUsesApplication(accounting, king)).toBe(true)
  })

  it('does not match unrelated applications', () => {
    expect(moduleUsesApplication(accounting, notion)).toBe(false)
    expect(moduleUsesApplication(banking, moneybird)).toBe(false)
  })
})

describe('applicationsForModule', () => {
  it('keeps catalog order and drops non-partners', () => {
    expect(
      applicationsForModule([moneybird, notion, king], accounting).map((a) => a.hostSlug),
    ).toEqual(['moneybird', 'king'])
  })

  it('returns nothing for a module without providers', () => {
    expect(applicationsForModule([moneybird, notion], banking)).toEqual([])
  })
})

describe('modulesForApplication', () => {
  it('lists the modules a connection can serve', () => {
    expect(modulesForApplication([accounting, banking], moneybird).map((m) => m.slug)).toEqual([
      'accounting',
    ])
  })

  it('returns nothing without an application', () => {
    expect(modulesForApplication([accounting], null)).toEqual([])
  })
})
