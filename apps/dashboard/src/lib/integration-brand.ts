import type { IntegrationHostRow, IntegrationProviderRow } from './integrations-api'
import type { Integration } from '../data/integrations-data'

export type ResolvedIntegrationBrand = {
  name: string
  initials: string
  color: string
  logoUrl: string | null
  logoDarkUrl: string | null
  hostSlug: string | null
}

import { BRAND_ASSETS, BRAND_ASSET_PATHS, brandAssetUrl } from './brand-assets'
import {
  REMOTE_MCP_HOSTS,
  REMOTE_MCP_PROVIDERS,
  logoUrlForHost,
} from './mcp-remote-providers'

export { brandAssetUrl, BRAND_ASSET_PATHS as HOST_STATIC_LOGO_FALLBACK }

const CORE_PROVIDER_TO_HOST_SLUG: Record<string, string> = {
  github: 'github',
  outlook: 'microsoft',
  'microsoft-365': 'microsoft',
  gmail: 'google',
  'google-workspace': 'google',
  google_calendar: 'google',
  'google-calendar': 'google',
  outlook_calendar: 'outlook',
  'outlook-calendar': 'outlook',
  king_accountancy: 'king',
  bjorn_lunden_mcp: 'bjorn_lunden',
  moneybird: 'moneybird',
  exact_online: 'exact',
  snelstart: 'snelstart',
  custom_mcp: 'custom',
  smtp_imap: 'smtp',
  shopify_mcp: 'shopify',
  shopify: 'shopify',
  gocardless_bank: 'gocardless',
  whatsapp: 'whatsapp',
}

export const PROVIDER_TO_HOST_SLUG: Record<string, string> = {
  ...CORE_PROVIDER_TO_HOST_SLUG,
  ...Object.fromEntries(REMOTE_MCP_PROVIDERS.flatMap((p) => [
    [p.slug, p.hostSlug],
    [p.staticId, p.hostSlug],
  ])),
}

const CORE_HOST_META: Record<string, { initials: string; color: string; name: string }> = {
  bokito: { initials: 'BK', color: '#7c3aed', name: 'Bokito' },
  github: { initials: 'GH', color: '#24292f', name: 'GitHub' },
  microsoft: { initials: 'MS', color: '#0078d4', name: 'Microsoft' },
  outlook: { initials: 'OL', color: '#0078d4', name: 'Outlook' },
  google: { initials: 'GO', color: '#4285f4', name: 'Google' },
  bjorn_lunden: { initials: 'BL', color: '#0f766e', name: 'Bjorn Lunden' },
  king: { initials: 'KA', color: '#0f766e', name: 'KING Accountancy' },
  moneybird: { initials: 'MB', color: '#0e5b99', name: 'Moneybird' },
  exact: { initials: 'EX', color: '#e2001a', name: 'Exact Online' },
  snelstart: { initials: 'SS', color: '#f39200', name: 'SnelStart' },
  gocardless: { initials: 'GC', color: '#f1f252', name: 'GoCardless' },
  custom: { initials: 'MC', color: '#475569', name: 'Custom MCP' },
  smtp: { initials: 'SM', color: '#64748b', name: 'SMTP / IMAP' },
  shopify: { initials: 'SH', color: '#96bf48', name: 'Shopify' },
  whatsapp: { initials: 'WA', color: '#25d366', name: 'WhatsApp' },
}

export const HOST_STATIC_BRAND_META: Record<string, { initials: string; color: string; name: string }> = {
  ...CORE_HOST_META,
  ...Object.fromEntries(
    REMOTE_MCP_HOSTS.map((h) => [h.slug, { initials: h.initials, color: h.brand_color, name: h.name }]),
  ),
}

function imageUrlFromUnknown(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>
    for (const key of ['url', 'path', 'src']) {
      const v = row[key]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
  }
  return null
}

/** Ignore empty hosted image placeholders so static fallbacks still apply. */
function apiImageUrlOrNull(value: unknown): string | null {
  const url = imageUrlFromUnknown(value)
  if (!url) return null
  if (url === 'null' || url === 'undefined') return null
  return url
}

export function hostSlugForProvider(providerOrCatalogId: string): string {
  return PROVIDER_TO_HOST_SLUG[providerOrCatalogId] ?? providerOrCatalogId
}

export function resolveHostBrand(
  hostSlug: string,
  apiHost?: IntegrationHostRow | null,
): ResolvedIntegrationBrand {
  const staticMeta = HOST_STATIC_BRAND_META[hostSlug]
  const staticLogo = BRAND_ASSETS[hostSlug]
  const catalogLogo = logoUrlForHost(hostSlug)

  const logoUrl = apiImageUrlOrNull(apiHost?.logo_url) ?? staticLogo?.logoUrl ?? catalogLogo ?? null

  const logoDarkUrl =
    apiImageUrlOrNull(apiHost?.logo_dark_url) ?? staticLogo?.logoDarkUrl ?? null

  return {
    name: apiHost?.name ?? staticMeta?.name ?? hostSlug,
    initials: apiHost?.initials ?? staticMeta?.initials ?? hostSlug.slice(0, 2).toUpperCase(),
    color: apiHost?.brand_color ?? staticMeta?.color ?? '#64748b',
    logoUrl,
    logoDarkUrl,
    hostSlug,
  }
}

export function resolveProviderBrand(
  providerOrCatalogId: string,
  apiHost?: IntegrationHostRow | null,
  logoMeta?: { initials?: string; color?: string },
  displayName?: string,
): ResolvedIntegrationBrand {
  const hostSlug = hostSlugForProvider(providerOrCatalogId)
  const base = resolveHostBrand(hostSlug, apiHost)
  return {
    ...base,
    name: displayName ?? base.name,
    initials: logoMeta?.initials ?? base.initials,
    color: logoMeta?.color ?? base.color,
  }
}

export function resolveProviderRowBrand(row: IntegrationProviderRow): ResolvedIntegrationBrand {
  return resolveProviderBrand(row.slug, row.host ?? null, row.logo_meta, row.name)
}

export function applyBrandToIntegration(
  integration: Integration,
  brand: ResolvedIntegrationBrand,
): Integration {
  return {
    ...integration,
    color: brand.color,
    initials: brand.initials,
    logoUrl: brand.logoUrl,
    logoDarkUrl: brand.logoDarkUrl,
    hostSlug: brand.hostSlug,
  }
}

export function buildHostsById(hosts: IntegrationHostRow[]): Map<string, IntegrationHostRow> {
  const map = new Map<string, IntegrationHostRow>()
  for (const h of hosts) {
    if (h.id) map.set(String(h.id), h)
  }
  return map
}

export function attachHostsToProviders(
  providers: IntegrationProviderRow[],
  hosts: IntegrationHostRow[],
): IntegrationProviderRow[] {
  const byId = buildHostsById(hosts)
  return providers.map((p) => {
    const withHost = p as IntegrationProviderRow & { host_id?: string }
    const hostId = withHost.host_id
    if (p.host) return p
    if (hostId && byId.has(hostId)) {
      return { ...p, host: byId.get(hostId) }
    }
    return p
  })
}
