import type { IntegrationKind } from '../lib/integration-kind'
import { BRAND_ASSETS } from '../lib/brand-assets'
import {
  REMOTE_MCP_HOST_BY_SLUG,
  REMOTE_MCP_PROVIDERS,
  logoUrlForHost,
} from '../lib/mcp-remote-providers'

const CORE_HOST_SLUG: Record<string, string> = {
  github: 'github',
  'microsoft-365': 'microsoft',
  'google-workspace': 'google',
  'google-calendar': 'google',
  'outlook-calendar': 'outlook',
  king_accountancy: 'king',
  bjorn_lunden_mcp: 'bjorn_lunden',
  moneybird: 'moneybird',
  exact_online: 'exact',
  snelstart: 'snelstart',
  custom_mcp: 'custom',
  shopify: 'shopify',
  whatsapp: 'whatsapp',
}

const STATIC_HOST_SLUG: Record<string, string> = {
  ...CORE_HOST_SLUG,
  ...Object.fromEntries(REMOTE_MCP_PROVIDERS.map((p) => [p.staticId, p.hostSlug])),
}

/** Business categories kept for API rows; marketplace filters by IntegrationKind instead. */
export type IntegrationCategory =
  | 'Communication'
  | 'Development'
  | 'Productivity'
  | 'Accounting'
  | 'Banking'
  | 'CRM'

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

/** Slugs registered in `integration_providers` (platform seed). */
export const PLATFORM_PROVIDER_SLUGS = [
  'github',
  'outlook',
  'gmail',
  'google_calendar',
  'outlook_calendar',
  'king_accountancy',
  'bjorn_lunden_mcp',
  'moneybird',
  'exact_online',
  'snelstart',
  'custom_mcp',
  'shopify_mcp',
  ...REMOTE_MCP_PROVIDERS.map((p) => p.slug),
] as const

export type PlatformProviderSlug = (typeof PLATFORM_PROVIDER_SLUGS)[number]

export function isPlatformProviderSlug(slug: string): slug is PlatformProviderSlug {
  return (PLATFORM_PROVIDER_SLUGS as readonly string[]).includes(slug)
}

/**
 * Static display metadata for live platform integrations (fallback when providers API is unavailable).
 * API slugs `outlook` / `gmail` map to these ids via ConnectionsMarketplace SLUG_TO_STATIC_ID.
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

function remoteMcpIntegration(p: (typeof REMOTE_MCP_PROVIDERS)[number]): Integration {
  const host = REMOTE_MCP_HOST_BY_SLUG[p.hostSlug]
  const meta = host
    ? { initials: host.initials, color: host.brand_color }
    : { initials: 'MC', color: '#475569' }
  const brand = staticBrand(p.staticId)
  return {
    id: p.staticId,
    name: p.name,
    description: p.description,
    category: p.category,
    kind: 'mcp',
    status: p.defaultStatus,
    color: meta.color,
    initials: meta.initials,
    ...brand,
    logoUrl: brand.logoUrl ?? logoUrlForHost(p.hostSlug),
  }
}

export const INTEGRATIONS: Integration[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Connect repositories for code indexing and agent context.',
    category: 'Development',
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
    description: 'Outlook mailboxes for inbox and email in Bokito.',
    category: 'Communication',
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
    description: 'Gmail mailboxes for inbox and email in Bokito.',
    category: 'Communication',
    kind: 'inbox',
    status: 'available',
    color: '#4285F4',
    initials: 'GM',
    popular: true,
    ...staticBrand('google-workspace'),
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Sync events into Agenda. Agents can list and propose calendar blocks.',
    category: 'Productivity',
    kind: 'calendar',
    status: 'available',
    color: '#4285F4',
    initials: 'GC',
    popular: true,
    ...staticBrand('google-calendar'),
  },
  {
    id: 'outlook-calendar',
    name: 'Outlook Calendar',
    description: 'Sync Microsoft 365 calendar into Agenda. Agents can list and propose blocks.',
    category: 'Productivity',
    kind: 'calendar',
    status: 'available',
    color: '#0078D4',
    initials: 'OC',
    popular: true,
    ...staticBrand('outlook-calendar'),
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'WhatsApp Business messages in the inbox via the Cloud API.',
    category: 'Communication',
    kind: 'inbox',
    status: 'available',
    color: '#25D366',
    initials: 'WA',
    popular: true,
    ...staticBrand('whatsapp'),
  },
  {
    id: 'king_accountancy',
    name: 'KING Accountancy',
    description: 'Read-only Cloudswitch access to KING Accountancy client administraties.',
    category: 'Productivity',
    kind: 'mcp',
    status: 'available',
    color: '#0F766E',
    initials: 'KA',
    ...staticBrand('king_accountancy'),
  },
  {
    id: 'bjorn_lunden_mcp',
    name: 'Bjorn Lunden MCP',
    description: 'Model Context Protocol connection for accounting and ERP tools.',
    category: 'Productivity',
    kind: 'mcp',
    status: 'available',
    color: '#0F766E',
    initials: 'BL',
    ...staticBrand('bjorn_lunden_mcp'),
  },
  {
    id: 'moneybird',
    name: 'Moneybird',
    description: 'Contacts, sales invoices, purchase documents and bank mutations via the Moneybird API.',
    category: 'Productivity',
    kind: 'app',
    status: 'available',
    color: '#0E5B99',
    initials: 'MB',
    ...staticBrand('moneybird'),
  },
  {
    id: 'exact_online',
    name: 'Exact Online',
    description: 'Full accounting via the Exact Online REST API (App Center partner track).',
    category: 'Productivity',
    kind: 'app',
    status: 'coming_soon',
    color: '#E2001A',
    initials: 'EX',
    ...staticBrand('exact_online'),
  },
  {
    id: 'snelstart',
    name: 'SnelStart',
    description: 'Relations, invoices and general ledger via the SnelStart B2B API (certification required).',
    category: 'Productivity',
    kind: 'app',
    status: 'coming_soon',
    color: '#F39200',
    initials: 'SS',
    ...staticBrand('snelstart'),
  },
  {
    id: 'custom_mcp',
    name: 'Custom tool',
    description: 'Connect any external tool by URL with API key or bearer token.',
    category: 'Productivity',
    kind: 'mcp',
    status: 'available',
    color: '#475569',
    initials: 'MC',
    ...staticBrand('custom_mcp'),
  },
  {
    id: 'shopify',
    name: 'Shopify',
    description: 'Connect a Shopify store for products, orders and storefront tools (per store).',
    category: 'Productivity',
    kind: 'mcp',
    status: 'coming_soon',
    color: '#96BF48',
    initials: 'SH',
    ...staticBrand('shopify'),
  },
  ...REMOTE_MCP_PROVIDERS.map(remoteMcpIntegration),
]
