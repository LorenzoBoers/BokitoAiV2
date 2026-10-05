import { describe, expect, it } from 'vitest'
import { hostSlugForProvider, indexProviderBrands, resolveProviderBrand } from './integration-brand'
import type { IntegrationProviderRow } from './integrations-api'

describe('hostSlugForProvider', () => {
  it('maps calendar slugs to a branded host', () => {
    expect(hostSlugForProvider('google_calendar')).toBe('google')
    expect(hostSlugForProvider('google-calendar')).toBe('google')
    expect(hostSlugForProvider('outlook_calendar')).toBe('outlook')
  })
})

describe('resolveProviderBrand', () => {
  it('always has a Google Calendar logo', () => {
    const brand = resolveProviderBrand('google_calendar')
    expect(brand.logoUrl).toBeTruthy()
  })
})

describe('indexProviderBrands', () => {
  it('indexes by catalog id and slug', () => {
    const row = {
      id: 'prov-google-cal',
      slug: 'google_calendar',
      name: 'Google Calendar',
      description: '',
      category: 'Productivity',
      auth_type: 'oauth2',
      status: 'available',
    } satisfies IntegrationProviderRow
    const map = indexProviderBrands([row])
    expect(map.get('prov-google-cal')?.logoUrl).toBeTruthy()
    expect(map.get('google_calendar')?.logoUrl).toBeTruthy()
  })
})
