import type { IntegrationKind } from '../lib/integration-kind'
import { BRAND_ASSETS } from '../lib/brand-assets'

const STATIC_HOST_SLUG: Record<string, string> = {
  github: 'github',
  'microsoft-365': 'microsoft',
  'google-workspace': 'google',
  bjorn_lunden_mcp: 'bjorn_lunden',
  custom_mcp: 'custom',
}

/** Business categories kept for API rows; marketplace filters by IntegrationKind instead. */
export type IntegrationCategory =
  | 'Communicatie'
  | 'Ontwikkeling'
  | 'Productiviteit'

export type IntegrationStatus = 'connected' | 'available' | 'coming_soon'

export interface Integration {
  id: string
  name: string
  description: string
  category: IntegrationCategory
  status: IntegrationStatus
  color: string
  initials: string
  kind: IntegrationKind
  logoUrl?: string | null
  logoDarkUrl?: string | null
  hostSlug?: string | null
  popular?: boolean
  connectedSince?: string
}

/** Slugs registered in Xano `integration_providers` (see integration-providers-seed.md). */
export const PLATFORM_PROVIDER_SLUGS = [
  'github',
  'outlook',
  'gmail',
  'bjorn_lunden_mcp',
  'custom_mcp',
] as const

export type PlatformProviderSlug = (typeof PLATFORM_PROVIDER_SLUGS)[number]

export function isPlatformProviderSlug(slug: string): slug is PlatformProviderSlug {
  return (PLATFORM_PROVIDER_SLUGS as readonly string[]).includes(slug)
}

/**
 * Static display metadata for live platform integrations (fallback when providers API is unavailable).
 * API slugs `outlook` / `gmail` map to these ids via IntegrationsMarketplace SLUG_TO_STATIC_ID.
 */
function staticBrand(id: string): Pick<Integration, 'hostSlug' | 'logoUrl' | 'logoDarkUrl'> {
  const hostSlug = STATIC_HOST_SLUG[id] ?? id
  const assets = BRAND_ASSETS[hostSlug]
  return {
    hostSlug,
    logoUrl: assets?.logoUrl ?? null,
    logoDarkUrl: assets?.logoDarkUrl ?? null,
  }
}

export const INTEGRATIONS: Integration[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Koppel repositories voor code-indexering en agentcontext.',
    category: 'Ontwikkeling',
    kind: 'repository',
    status: 'available',
    color: '#24292E',
    initials: 'GH',
    popular: true,
    ...staticBrand('github'),
  },
  {
    id: 'microsoft-365',
    name: 'Microsoft 365',
    description: 'Outlook-mailboxen voor inbox en e-mail in Bokito.',
    category: 'Communicatie',
    kind: 'inbox',
    status: 'available',
    color: '#0078D4',
    initials: 'OL',
    popular: true,
    ...staticBrand('microsoft-365'),
  },
  {
    id: 'google-workspace',
    name: 'Google Workspace',
    description: 'Gmail-mailboxen voor inbox en e-mail in Bokito.',
    category: 'Communicatie',
    kind: 'inbox',
    status: 'available',
    color: '#4285F4',
    initials: 'GM',
    popular: true,
    ...staticBrand('google-workspace'),
  },
  {
    id: 'bjorn_lunden_mcp',
    name: 'Bjorn Lunden MCP',
    description: 'Model Context Protocol-koppeling voor boekhoud- en ERP-tools.',
    category: 'Productiviteit',
    kind: 'mcp',
    status: 'available',
    color: '#0F766E',
    initials: 'BL',
    ...staticBrand('bjorn_lunden_mcp'),
  },
  {
    id: 'custom_mcp',
    name: 'Custom MCP server',
    description: 'Connect any external MCP server by URL with API key or bearer token.',
    category: 'Productiviteit',
    kind: 'mcp',
    status: 'available',
    color: '#475569',
    initials: 'MC',
    ...staticBrand('custom_mcp'),
  },
]
