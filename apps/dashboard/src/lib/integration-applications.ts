import type { Integration } from '../data/integrations-data'
import type { IntegrationProviderRow } from './integrations-api'
import { hostSlugForProvider, resolveProviderBrand, type ResolvedIntegrationBrand } from './integration-brand'
import { resolveIntegrationKind, type IntegrationKind } from './integration-kind'
import { getRegistryEntryByStaticId, type ProviderRegistryEntry } from './integrations/registry'
import { REMOTE_MCP_HOSTS, REMOTE_MCP_PROVIDERS } from './mcp-remote-providers'

/** One connectable product under an application (maps to `integration_providers`). */
export type IntegrationOffer = {
  integration: Integration
  provider?: IntegrationProviderRow
  registry?: ProviderRegistryEntry
  connectionCount: number
  kind: IntegrationKind
}

/**
 * Marketplace application (= `integration_hosts` row).
 * Multiple offers share the same host (e.g. GitHub repo + GitHub MCP).
 */
export type IntegrationApplication = {
  hostSlug: string
  name: string
  description: string
  brand: ResolvedIntegrationBrand
  offers: IntegrationOffer[]
  connectionCount: number
  /** Worst-case status for the app card CTA. */
  status: Integration['status']
  kinds: IntegrationKind[]
  /** Module slug (accounting, banking, ...) when the app belongs to a module. */
  module: string | null
}

const CORE_HOST_DISPLAY: Record<string, { name: string; description: string }> = {
  github: {
    name: 'GitHub',
    description: 'Repositories for code indexing and optional GitHub tools for agents.',
  },
  microsoft: {
    name: 'Microsoft',
    description: 'Outlook mailboxes and optional Microsoft Graph tools (Entra directory, preview).',
  },
  google: {
    name: 'Google',
    description: 'Gmail mailboxes for inbox and email in Bokito.',
  },
  king: {
    name: 'KING Accountancy',
    description: 'Read-only Cloudswitch access to KING Accountancy client administraties.',
  },
  bjorn_lunden: {
    name: 'Bjorn Lunden',
    description: 'Accounting and ERP tools via the Swedish Bjorn Lunden BLA API.',
  },
  moneybird: {
    name: 'Moneybird',
    description: 'Contacts, invoices, purchases and bank mutations via the Moneybird API.',
  },
  exact: {
    name: 'Exact Online',
    description: 'Full accounting via the Exact Online REST API or hosted MCP partner.',
  },
  snelstart: {
    name: 'SnelStart',
    description: 'Relations, invoices and general ledger via the SnelStart B2B API.',
  },
  gocardless: {
    name: 'GoCardless',
    description: 'Read-only PSD2 bank account data via GoCardless Bank Account Data.',
  },
  custom: {
    name: 'Custom tool',
    description: 'Any external tool by URL with API key or bearer token.',
  },
  shopify: {
    name: 'Shopify',
    description: 'Storefront and admin data for e-commerce agents (per-store OAuth).',
  },
  whatsapp: {
    name: 'WhatsApp',
    description: 'WhatsApp Business messages in the inbox via the Cloud API.',
  },
}

const HOST_DISPLAY: Record<string, { name: string; description: string }> = {
  ...CORE_HOST_DISPLAY,
  ...Object.fromEntries(
    REMOTE_MCP_HOSTS.map((h) => [
      h.slug,
      { name: h.name, description: h.description || h.name },
    ]),
  ),
}

const CORE_MODULE_BY_PROVIDER: Record<string, string> = {
  king_accountancy: 'accounting',
  bjorn_lunden_mcp: 'accounting',
  moneybird: 'accounting',
  exact_online: 'accounting',
  snelstart: 'accounting',
  gocardless_bank: 'banking',
}

export const MODULE_BY_PROVIDER_SLUG: Record<string, string> = {
  ...CORE_MODULE_BY_PROVIDER,
  ...Object.fromEntries(
    REMOTE_MCP_PROVIDERS.filter((p) => p.module).map((p) => [p.slug, p.module as string]),
  ),
}

const CORE_MODULE_BY_HOST: Record<string, string> = {
  king: 'accounting',
  bjorn_lunden: 'accounting',
  moneybird: 'accounting',
  exact: 'accounting',
  snelstart: 'accounting',
  gocardless: 'banking',
}

const MODULE_BY_HOST: Record<string, string> = {
  ...CORE_MODULE_BY_HOST,
  ...Object.fromEntries(
    REMOTE_MCP_PROVIDERS.filter((p) => p.module).map((p) => [p.hostSlug, p.module as string]),
  ),
}

export function moduleForApplication(hostSlug: string, offers: IntegrationOffer[]): string | null {
  for (const offer of offers) {
    const fromProvider = offer.provider?.module
    if (fromProvider) return fromProvider
  }
  return MODULE_BY_HOST[hostSlug] ?? null
}

export function hostSlugForOffer(integration: Integration, provider?: IntegrationProviderRow): string {
  if (provider?.host?.slug) return provider.host.slug
  if (integration.hostSlug?.trim()) return integration.hostSlug.trim()
  const slug = provider?.slug ?? getRegistryEntryByStaticId(integration.id)?.platformSlug ?? integration.id
  return hostSlugForProvider(slug)
}

function appStatusFromOffers(offers: IntegrationOffer[]): Integration['status'] {
  if (offers.every((o) => o.integration.status === 'coming_soon')) return 'coming_soon'
  if (offers.some((o) => o.integration.status === 'available')) return 'available'
  return offers[0]?.integration.status ?? 'available'
}

function appDescription(hostSlug: string, offers: IntegrationOffer[]): string {
  const preset = HOST_DISPLAY[hostSlug]
  if (preset) return preset.description
  if (offers.length === 1) return offers[0].integration.description
  return offers.map((o) => o.integration.name).join(', ')
}

export function buildIntegrationApplications(
  rows: Array<{ integration: Integration; connectionCount: number }>,
  findProvider: (integration: Integration) => IntegrationProviderRow | undefined,
): IntegrationApplication[] {
  const byHost = new Map<string, IntegrationOffer[]>()

  for (const { integration, connectionCount } of rows) {
    const provider = findProvider(integration)
    const hostSlug = hostSlugForOffer(integration, provider)
    const kind = integration.kind ?? resolveIntegrationKind(provider?.slug ?? integration.id, provider?.capabilities)
    const offer: IntegrationOffer = {
      integration,
      provider,
      registry: getRegistryEntryByStaticId(integration.id),
      connectionCount,
      kind,
    }
    const list = byHost.get(hostSlug) ?? []
    list.push(offer)
    byHost.set(hostSlug, list)
  }

  const apps: IntegrationApplication[] = []

  for (const [hostSlug, offers] of byHost) {
    offers.sort((a, b) => a.integration.name.localeCompare(b.integration.name))

    const primary = offers[0]
    const apiHost = primary.provider?.host ?? null
    const brand = resolveProviderBrand(
      hostSlug,
      apiHost,
      { initials: primary.integration.initials, color: primary.integration.color },
      HOST_DISPLAY[hostSlug]?.name ?? primary.integration.name,
    )

    const connectionCount = offers.reduce((sum, o) => sum + o.connectionCount, 0)
    const kinds = [...new Set(offers.map((o) => o.kind))]

    apps.push({
      hostSlug,
      name: HOST_DISPLAY[hostSlug]?.name ?? brand.name,
      description: appDescription(hostSlug, offers),
      brand,
      offers,
      connectionCount,
      status: appStatusFromOffers(offers),
      kinds,
      module: moduleForApplication(hostSlug, offers),
    })
  }

  apps.sort((a, b) => a.name.localeCompare(b.name))
  return apps
}

type TranslateFn = (key: string, opts?: { defaultValue?: string }) => string

export function localizeApplication<T extends { hostSlug: string; name: string; description: string }>(
  app: T,
  t: TranslateFn,
): T {
  return {
    ...app,
    name: t(`integrations.hosts.${app.hostSlug}.name`, { defaultValue: app.name }),
    description: t(`integrations.hosts.${app.hostSlug}.description`, { defaultValue: app.description }),
  }
}

export function localizeOfferDescription(
  hostSlug: string,
  fallback: string,
  t: TranslateFn,
): string {
  return t(`integrations.hosts.${hostSlug}.description`, { defaultValue: fallback })
}

export function findApplicationByHostSlug(
  apps: IntegrationApplication[],
  hostSlug: string,
): IntegrationApplication | undefined {
  return apps.find((a) => a.hostSlug === hostSlug)
}

export function findOfferInApplication(
  app: IntegrationApplication,
  integrationId: string,
): IntegrationOffer | undefined {
  return app.offers.find((o) => o.integration.id === integrationId)
}

/** Legacy connect param may be static id or host slug. */
export function resolveApplicationConnectTarget(
  apps: IntegrationApplication[],
  connectParam: string,
): { app: IntegrationApplication; offer?: IntegrationOffer } | null {
  const byHost = findApplicationByHostSlug(apps, connectParam)
  if (byHost) {
    const offer = findOfferInApplication(byHost, connectParam) ?? byHost.offers[0]
    return { app: byHost, offer }
  }

  for (const app of apps) {
    const offer = findOfferInApplication(app, connectParam)
    if (offer) return { app, offer }
  }
  return null
}
