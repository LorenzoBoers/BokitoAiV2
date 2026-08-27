import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  INTEGRATIONS,
  isPlatformProviderSlug,
  type Integration,
  type IntegrationStatus,
} from '../data/integrations-data'
import { listGithubConnections } from '../lib/github-api'
import { applyBrandToIntegration, resolveProviderBrand } from '../lib/integration-brand'
import { resolveIntegrationKind } from '../lib/integration-kind'
import { integrationIdToPlatformSlug } from '../lib/integration-setup'
import { FALLBACK_MODULES } from '../lib/integration-modules'
import {
  buildIntegrationApplications,
  type IntegrationApplication,
} from '../lib/integration-applications'
import {
  connectionCountForProvider,
  listIntegrationProviders,
  type IntegrationModuleRow,
  type IntegrationProviderRow,
  type ProvidersListResponse,
} from '../lib/integrations-api'
import { getRegistryEntryByStaticId, SLUG_TO_STATIC_ID } from '../lib/integrations/registry'

function providerToIntegration(
  p: IntegrationProviderRow,
  count: number,
  staticRow?: Integration,
): Integration {
  const status: IntegrationStatus =
    p.status === 'coming_soon' ? 'coming_soon' : count > 0 ? 'connected' : 'available'
  const id = staticRow?.id ?? p.slug
  const brand = resolveProviderBrand(p.slug, p.host ?? null, p.logo_meta, p.name)
  const base: Integration = {
    id,
    name: p.name,
    description: p.description || staticRow?.description || '',
    category: staticRow?.category ?? 'Productivity',
    status,
    kind: staticRow?.kind ?? resolveIntegrationKind(p.slug, p.capabilities),
    color: brand.color,
    initials: brand.initials,
    logoUrl: brand.logoUrl,
    logoDarkUrl: brand.logoDarkUrl,
    hostSlug: brand.hostSlug,
    popular: staticRow?.popular,
    connectedSince: count > 0 ? new Date().toISOString().slice(0, 10) : undefined,
  }
  return staticRow ? applyBrandToIntegration({ ...staticRow, ...base }, brand) : base
}

function connectionCountForItem(
  integration: Integration,
  counts: ProvidersListResponse['connection_counts'] | null,
  providers: IntegrationProviderRow[],
  githubLen: number,
): number {
  const entry = getRegistryEntryByStaticId(integration.id)
  if (entry?.connectionCountSource === 'github_api') return Math.max(githubLen, 0)
  if (entry?.connectionCountSource === 'email_outlook' && counts) return counts.email_outlook ?? 0
  if (entry?.connectionCountSource === 'email_gmail' && counts) return counts.email_gmail ?? 0
  const provider = providers.find(
    (p) => p.slug === integration.id || SLUG_TO_STATIC_ID[p.slug] === integration.id,
  )
  if (!provider || !counts) {
    if (integration.status === 'connected') return 1
    return 0
  }
  return connectionCountForProvider(provider, counts)
}

export function useIntegrationCatalog() {
  const { t } = useTranslation(['nav'])
  const [items, setItems] = useState<Integration[]>(INTEGRATIONS)
  const [providers, setProviders] = useState<IntegrationProviderRow[]>([])
  const [modules, setModules] = useState<IntegrationModuleRow[]>(FALLBACK_MODULES)
  const [connectionCounts, setConnectionCounts] = useState<
    ProvidersListResponse['connection_counts'] | null
  >(null)
  const [githubConnections, setGithubConnections] = useState<{ id: string; github_login: string }[]>(
    [],
  )
  const [loadError, setLoadError] = useState<string | null>(null)

  const findProviderForIntegration = useCallback(
    (integration: Integration): IntegrationProviderRow | undefined => {
      const slug = integrationIdToPlatformSlug(integration.id)
      return providers.find((p) => p.slug === slug || SLUG_TO_STATIC_ID[p.slug] === integration.id)
    },
    [providers],
  )

  const catalogRows = useMemo(
    () =>
      items.map((integration) => ({
        integration,
        connectionCount: connectionCountForItem(
          integration,
          connectionCounts,
          providers,
          githubConnections.length,
        ),
      })),
    [items, connectionCounts, providers, githubConnections.length],
  )

  const applications = useMemo(
    () => buildIntegrationApplications(catalogRows, findProviderForIntegration),
    [catalogRows, findProviderForIntegration],
  )

  const refreshCatalog = useCallback(async () => {
    setLoadError(null)
    try {
      const { providers: p, connection_counts, modules: moduleRows } = await listIntegrationProviders()
      setProviders(p)
      setConnectionCounts(connection_counts)
      if (moduleRows?.length) setModules(moduleRows)
      const staticById = new Map(INTEGRATIONS.map((i) => [i.id, i]))
      const liveProviders = p.filter((row) => isPlatformProviderSlug(row.slug))
      const fromApi: Integration[] = liveProviders.map((row) => {
        const count = connectionCountForProvider(row, connection_counts)
        const staticId = SLUG_TO_STATIC_ID[row.slug] ?? row.slug
        return providerToIntegration(row, count, staticById.get(staticId))
      })
      const coveredStaticIds = new Set(
        liveProviders.map((row) => SLUG_TO_STATIC_ID[row.slug] ?? row.slug),
      )
      const missingStatic = INTEGRATIONS.filter((i) => !coveredStaticIds.has(i.id)).map((i) => ({
        ...i,
        kind: i.kind ?? resolveIntegrationKind(i.id),
      }))
      setItems([...fromApi, ...missingStatic])
    } catch {
      setLoadError(
        t('integrations.marketplace.catalogFallback', {
          defaultValue: 'Catalog API unavailable; using local list.',
        }),
      )
      setProviders([])
      setConnectionCounts(null)
      setItems(
        INTEGRATIONS.map((i) => {
          const brand = resolveProviderBrand(
            i.id,
            null,
            { initials: i.initials, color: i.color },
            i.name,
          )
          return applyBrandToIntegration(
            { ...i, kind: i.kind ?? resolveIntegrationKind(i.id) },
            brand,
          )
        }),
      )
    }
    try {
      setGithubConnections(await listGithubConnections())
    } catch {
      setGithubConnections([])
    }
  }, [t])

  useEffect(() => {
    void refreshCatalog()
  }, [refreshCatalog])

  return {
    applications,
    modules,
    loadError,
    refreshCatalog,
  }
}
