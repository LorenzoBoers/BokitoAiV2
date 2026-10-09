import { describe, expect, it } from 'vitest'
import { INTEGRATIONS } from '../data/integrations-data'
import { resolveIntegrationKind } from './integration-kind'
import {
  buildIntegrationApplications,
  effectiveOfferKind,
  filterOfferRows,
  flattenApplicationOffers,
} from './integration-applications'
import { SLUG_TO_STATIC_ID, STATIC_ID_TO_SLUG } from './integrations/registry'
import { integrationIdToPlatformSlug } from './integration-setup'
import type { IntegrationProviderRow } from './integrations-api'
import type { Integration } from '../data/integrations-data'

function providerToIntegration(p: IntegrationProviderRow): Integration {
  const id = SLUG_TO_STATIC_ID[p.slug] ?? p.slug
  return {
    id,
    name: p.name,
    description: p.description || '',
    category: 'Productivity',
    status: p.status === 'coming_soon' ? 'coming_soon' : 'available',
    kind: resolveIntegrationKind(p.slug, p.capabilities),
    color: '#0061ff',
    initials: 'DB',
    hostSlug: p.host?.slug,
  }
}

const PROVIDERS: IntegrationProviderRow[] = [
  {
    id: '1',
    slug: 'dropbox',
    name: 'Dropbox',
    description: 'Search and read Dropbox files into Knowledge (planned for Documents).',
    category: 'Documenten',
    auth_type: 'oauth2',
    status: 'coming_soon',
    capabilities: { documents: true },
    module: 'documents',
    host: { id: 'h1', slug: 'dropbox', name: 'Dropbox', brand_color: '#0061ff', initials: 'DB' },
  },
  {
    id: '2',
    slug: 'dropbox_mcp',
    name: 'Dropbox',
    description: 'Dropbox files and folders.',
    category: 'Productivity',
    auth_type: 'mcp_remote_oauth',
    status: 'coming_soon',
    capabilities: { mcp_tools: true },
    module: null,
    mcp_remote_url: '',
    host: { id: 'h1', slug: 'dropbox', name: 'Dropbox', brand_color: '#0061ff', initials: 'DB' },
  },
  {
    id: '3',
    slug: 'outlook_calendar',
    name: 'Outlook Calendar',
    description: 'Sync Microsoft 365 calendar into Agenda.',
    category: 'Agenda',
    auth_type: 'oauth2',
    status: 'available',
    capabilities: { calendar: true },
    module: null,
    host: { id: 'h2', slug: 'microsoft', name: 'Microsoft', brand_color: '#0078d4', initials: 'MS' },
  },
  {
    id: '4',
    slug: 'google_calendar',
    name: 'Google Calendar',
    description: 'Sync events into Agenda.',
    category: 'Agenda',
    auth_type: 'oauth2',
    status: 'available',
    capabilities: { calendar: true },
    module: null,
    host: { id: 'h3', slug: 'google', name: 'Google', brand_color: '#4285f4', initials: 'G' },
  },
]

describe('dropbox marketplace catalog', () => {
  it('keeps dropbox_mcp static id distinct from core dropbox', () => {
    expect(SLUG_TO_STATIC_ID['dropbox_mcp']).toBe('dropbox-mcp')
    expect(STATIC_ID_TO_SLUG['dropbox-mcp']).toBe('dropbox_mcp')
    expect(STATIC_ID_TO_SLUG['dropbox']).toBeUndefined()
    expect(integrationIdToPlatformSlug('dropbox')).toBe('dropbox')
    expect(INTEGRATIONS.filter((i) => i.id === 'dropbox')).toHaveLength(0)
    expect(INTEGRATIONS.some((i) => i.id === 'dropbox-mcp')).toBe(true)
  })

  it('classifies documents Dropbox as app and MCP as mcp', () => {
    expect(resolveIntegrationKind('dropbox', { documents: true })).toBe('app')
    expect(resolveIntegrationKind('dropbox_mcp', { mcp_tools: true })).toBe('mcp')
  })

  it('Agenda filter only lists calendar-capable offers', () => {
    const fromApi = PROVIDERS.map((row) => providerToIntegration(row))
    const findProvider = (integration: Integration) => {
      const slug = integrationIdToPlatformSlug(integration.id)
      return (
        PROVIDERS.find((p) => p.slug === slug) ||
        PROVIDERS.find((p) => p.slug === integration.id) ||
        PROVIDERS.find((p) => SLUG_TO_STATIC_ID[p.slug] === integration.id)
      )
    }

    const apps = buildIntegrationApplications(
      fromApi.map((integration) => ({
        integration,
        connectionCount: integration.id.includes('outlook') ? 1 : 0,
      })),
      findProvider,
    )

    const t = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key
    const calendar = filterOfferRows(flattenApplicationOffers(apps), 'calendar', '', t)
    const ids = calendar.map((row) => row.offer.integration.id).sort()

    expect(ids).toEqual(['google-calendar', 'outlook-calendar'])
    expect(calendar.every((row) => effectiveOfferKind(row.offer) === 'calendar')).toBe(true)
    expect(ids).not.toContain('dropbox')
    expect(ids).not.toContain('dropbox-mcp')
  })
})
