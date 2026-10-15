import { describe, expect, it } from 'vitest'
import {
  applicationsForModule,
  isModulePackageOffer,
  marketplaceOfferRows,
  moduleForPackageSlug,
  moduleMatchesMarketplaceQuery,
  modulePackageProviderSlugs,
  moduleUsesApplication,
  modulesForApplication,
} from './module-applications'
import type { IntegrationApplication, IntegrationOffer } from './integration-applications'
import type { IntegrationModuleRow } from './integrations-api'

function app(hostSlug: string, module: string | null, providerSlugs: string[]) {
  return {
    hostSlug,
    name: hostSlug,
    description: `${hostSlug} description`,
    module,
    offers: providerSlugs.map((slug) => ({
      integration: { id: slug, name: slug, description: `${slug} offer`, status: 'available' },
      provider: { slug },
      kind: slug.endsWith('_mcp') ? 'mcp' : 'app',
      connectionCount: 0,
    })),
  } as unknown as IntegrationApplication
}

function moduleRow(slug: string, providerSlugs: string[], planned: string[] = []) {
  return {
    slug,
    name: slug,
    description: `${slug} module`,
    provider_slugs: providerSlugs,
    planned_provider_slugs: planned,
  } as unknown as IntegrationModuleRow
}

const accounting = moduleRow('accounting', ['moneybird', 'king_accountancy'], [
  'exact_online',
  'moneybird_mcp',
])
const banking = moduleRow('banking', [])

const moneybird = app('moneybird', 'accounting', ['moneybird', 'moneybird_mcp'])
const king = app('king', null, ['king_accountancy'])
const notion = app('notion', null, ['notion'])
const t = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key

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

  it('matches planned partner slugs on coming-soon modules', () => {
    const documents = moduleRow('documents', [], ['google_drive', 'dropbox'])
    const drive = app('google_drive', 'documents', ['google_drive'])
    expect(moduleUsesApplication(documents, drive)).toBe(true)
    expect(applicationsForModule([drive, notion], documents).map((a) => a.hostSlug)).toEqual([
      'google_drive',
    ])
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

describe('module package marketplace rules', () => {
  it('hides native module packages but keeps remote MCP offers', () => {
    const packageSlugs = modulePackageProviderSlugs([accounting])
    expect(packageSlugs.has('moneybird')).toBe(true)
    expect(packageSlugs.has('king_accountancy')).toBe(true)
    expect(packageSlugs.has('exact_online')).toBe(true)
    expect(packageSlugs.has('moneybird_mcp')).toBe(false)

    const rows = marketplaceOfferRows([moneybird, king, notion], [accounting])
    expect(rows.map((row) => row.offer.provider?.slug)).toEqual(['moneybird_mcp', 'notion'])
  })

  it('routes package deep links to the owning module', () => {
    expect(moduleForPackageSlug([accounting], 'moneybird')?.slug).toBe('accounting')
    expect(moduleForPackageSlug([accounting], 'moneybird_mcp')).toBeNull()
  })

  it('matches modules on partner names when searching the marketplace', () => {
    expect(moduleMatchesMarketplaceQuery(accounting, [moneybird, king], 'mone', t)).toBe(true)
    expect(moduleMatchesMarketplaceQuery(accounting, [moneybird, king], 'king', t)).toBe(true)
    expect(moduleMatchesMarketplaceQuery(banking, [moneybird], 'mone', t)).toBe(false)
  })

  it('treats offers by platform slug for package detection', () => {
    const packageSlugs = modulePackageProviderSlugs([accounting])
    const offer = moneybird.offers[0] as IntegrationOffer
    expect(isModulePackageOffer(offer, packageSlugs)).toBe(true)
    expect(isModulePackageOffer(moneybird.offers[1] as IntegrationOffer, packageSlugs)).toBe(false)
  })
})
