import type { Integration } from '../data/integrations-data'
import type { IntegrationProviderRow } from './integrations-api'
import { hostSlugForProvider, resolveProviderBrand, type ResolvedIntegrationBrand } from './integration-brand'
import { resolveIntegrationKind, type IntegrationKind } from './integration-kind'
import { getRegistryEntryByStaticId, type ProviderRegistryEntry } from './integrations/registry'

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
}

const HOST_DISPLAY: Record<string, { name: string; description: string }> = {
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
  notion: {
    name: 'Notion',
    description: 'Workspace pages and knowledge via sign-in.',
  },
  linear: {
    name: 'Linear',
    description: 'Issues, projects, and comments via sign-in.',
  },
  atlassian: {
    name: 'Atlassian',
    description: 'Jira, Confluence, and Compass via Atlassian.',
  },
  slack: {
    name: 'Slack',
    description: 'Channels and messages via Slack.',
  },
  asana: { name: 'Asana', description: 'Tasks and projects in Asana.' },
  clickup: { name: 'ClickUp', description: 'ClickUp workspaces and tasks.' },
  sentry: { name: 'Sentry', description: 'Issues and debugging context from Sentry.' },
  stripe: { name: 'Stripe', description: 'Billing data and actions from Stripe.' },
  shopify: {
    name: 'Shopify',
    description: 'Storefront and admin data for e-commerce agents (per-store OAuth).',
  },
  king: {
    name: 'KING Accountancy',
    description: 'Read-only Cloudswitch access to KING Accountancy client administraties.',
  },
  bjorn_lunden: {
    name: 'Bjorn Lunden',
    description: 'Accounting and ERP tools via the Swedish Bjorn Lunden BLA API.',
  },
  custom: {
    name: 'Custom tool',
    description: 'Any external tool by URL with API key or bearer token.',
  },
  higgsfield: {
    name: 'Higgsfield',
    description: 'AI image and video generation via Higgsfield.',
  },
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
    })
  }

  apps.sort((a, b) => a.name.localeCompare(b.name))
  return apps
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
  if (byHost) return { app: byHost }

  for (const app of apps) {
    const offer = findOfferInApplication(app, connectParam)
    if (offer) return { app, offer }
  }
  return null
}
