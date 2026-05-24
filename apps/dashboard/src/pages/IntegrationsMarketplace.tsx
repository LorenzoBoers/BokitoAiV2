import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import {
  INTEGRATIONS,
  isPlatformProviderSlug,
  type Integration,
  type IntegrationStatus,
} from '../data/integrations-data'
import {
  connectionCountForProvider,
  listIntegrationProviders,
  startIntegrationOAuth,
  type IntegrationProviderRow,
  type ProvidersListResponse,
} from '../lib/integrations-api'
import { parseIntegrationCallback } from '../lib/integrations-oauth'
import { listGithubConnections, startGithubOAuth } from '../lib/github-api'
import { resolveIntegrationKind, type IntegrationKind } from '../lib/integration-kind'
import {
  parseKindFilter,
  kindFilterToParam,
  connectedPathWithKind,
  type IntegrationKindFilter,
} from '../lib/integration-kind-url'
import { applyBrandToIntegration, resolveProviderBrand } from '../lib/integration-brand'
import { ProviderCard } from '../components/integrations/ProviderCard'
import { IntegrationKindNav } from '../components/integrations/IntegrationKindNav'
import { Input } from '../components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import { EmptyState } from '../components/ui/empty-state'
import { PageContent } from '../components/layout/PageContent'

const SLUG_TO_STATIC_ID: Record<string, string> = {
  github: 'github',
  outlook: 'microsoft-365',
  gmail: 'google-workspace',
  microsoft_mail: 'microsoft-365',
  google_mail: 'google-workspace',
  bjorn_lunden_mcp: 'bjorn_lunden_mcp',
  custom_mcp: 'custom_mcp',
}

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
    category: staticRow?.category ?? 'Productiviteit',
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
  if (integration.id === 'github') return Math.max(githubLen, 0)
  if (integration.id === 'microsoft-365' && counts) return counts.email_outlook ?? 0
  if (integration.id === 'google-workspace' && counts) return counts.email_gmail ?? 0
  const provider = providers.find(
    (p) => p.slug === integration.id || SLUG_TO_STATIC_ID[p.slug] === integration.id,
  )
  if (!provider || !counts) {
    if (integration.status === 'connected') return 1
    return 0
  }
  return connectionCountForProvider(provider, counts)
}

export default function IntegrationsMarketplace() {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const kindFilter = parseKindFilter(searchParams.get('kind'))
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'connected' | 'available'>('all')
  const [items, setItems] = useState<Integration[]>(INTEGRATIONS)
  const [providers, setProviders] = useState<IntegrationProviderRow[]>([])
  const [connectionCounts, setConnectionCounts] = useState<
    ProvidersListResponse['connection_counts'] | null
  >(null)
  const [githubConnections, setGithubConnections] = useState<{ id: string; github_login: string }[]>(
    [],
  )
  const [loadError, setLoadError] = useState<string | null>(null)

  const setKindFilter = useCallback(
    (next: IntegrationKindFilter) => {
      const param = kindFilterToParam(next)
      const params = new URLSearchParams(searchParams)
      if (param) params.set('kind', param)
      else params.delete('kind')
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const refreshCatalog = useCallback(async () => {
    setLoadError(null)
    try {
      const { providers: p, connection_counts } = await listIntegrationProviders()
      setProviders(p)
      setConnectionCounts(connection_counts)
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
      setLoadError('Catalog API unavailable; using local list.')
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
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const callback = parseIntegrationCallback(params)
    if (callback.handled) {
      const next = new URL(window.location.href)
      ;['integration', 'integration_error', 'provider', 'github', 'github_error'].forEach((k) =>
        next.searchParams.delete(k),
      )
      window.history.replaceState({}, '', next.pathname + next.search)
      if (callback.error) setLoadError(callback.error)
    }
    void refreshCatalog()
  }, [refreshCatalog])

  const handleSetup = async (id: string) => {
    if (id === 'github') {
      const returnUrl = `${window.location.origin}${window.location.pathname}`
      try {
        const { authorize_url } = await startGithubOAuth(returnUrl)
        window.location.href = authorize_url
      } catch {
        const { authorize_url } = await startIntegrationOAuth('github', encodeURIComponent(returnUrl))
        window.location.href = authorize_url
      }
      return
    }
    if (id === 'microsoft-365' || id === 'google-workspace') {
      window.location.href = '/settings/inbox'
      return
    }
    if (id === 'bjorn_lunden_mcp') {
      navigate('/integrations/mcp?connect=bjorn_lunden_mcp')
      return
    }
    if (id === 'custom_mcp') {
      navigate('/integrations/mcp?connect=custom_mcp')
    }
  }

  const handleViewConnected = (integration: Integration) => {
    const kind = integration.kind ?? resolveIntegrationKind(integration.id)
    navigate(connectedPathWithKind(kind))
  }

  const handleSetupInMcp = (integration: Integration) => {
    if (integration.id === 'bjorn_lunden_mcp') {
      navigate('/integrations/mcp?connect=bjorn_lunden_mcp')
      return
    }
    navigate('/integrations/mcp?connect=custom_mcp')
  }

  useEffect(() => {
    const connect = searchParams.get('connect')
    if (connect === 'bjorn_lunden_mcp' || connect === 'custom_mcp') {
      navigate(`/integrations/mcp?connect=${connect}`, { replace: true })
    }
  }, [searchParams, navigate])

  const filtered = useMemo(() => {
    let list = items.map((integration) => ({
      integration,
      connectionCount: connectionCountForItem(
        integration,
        connectionCounts,
        providers,
        githubConnections.length,
      ),
    }))

    if (kindFilter !== 'all') {
      list = list.filter(
        ({ integration }) =>
          (integration.kind ?? resolveIntegrationKind(integration.id)) === kindFilter,
      )
    }
    if (statusFilter === 'connected') {
      list = list.filter(({ connectionCount }) => connectionCount > 0)
    }
    if (statusFilter === 'available') {
      list = list.filter(
        ({ integration, connectionCount }) =>
          connectionCount === 0 && integration.status !== 'coming_soon',
      )
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(({ integration }) => {
        const kind = integration.kind ?? resolveIntegrationKind(integration.id)
        return (
          integration.name.toLowerCase().includes(q) ||
          integration.description.toLowerCase().includes(q) ||
          t(`integrations.kind.${kind}`).toLowerCase().includes(q)
        )
      })
    }

    list.sort((a, b) => {
      const aConn = a.connectionCount > 0 ? 0 : 1
      const bConn = b.connectionCount > 0 ? 0 : 1
      if (aConn !== bConn) return aConn - bConn
      return a.integration.name.localeCompare(b.integration.name)
    })

    return list
  }, [
    items,
    kindFilter,
    statusFilter,
    search,
    connectionCounts,
    providers,
    githubConnections.length,
    t,
  ])

  const connectedTotal = useMemo(() => {
    const seen = new Set<string>()
    let n = 0
    for (const { integration, connectionCount } of items.map((integration) => ({
      integration,
      connectionCount: connectionCountForItem(
        integration,
        connectionCounts,
        providers,
        githubConnections.length,
      ),
    }))) {
      if (connectionCount > 0 && !seen.has(integration.id)) {
        seen.add(integration.id)
        n += 1
      }
    }
    return n
  }, [items, connectionCounts, providers, githubConnections.length])

  return (
    <PageContent width="xl">
      <div className="mb-6">
        <p className="max-w-2xl text-sm text-text-secondary">
          {t('integrations.pageMeta.marketplace.description')}
        </p>
        {loadError ? <p className="mt-2 text-xs text-text-muted">{loadError}</p> : null}
        <p className="mt-3 text-xs text-text-muted">
          {t('integrations.marketplace.connectedCount', { count: connectedTotal })}
        </p>
      </div>

      <div className="mb-6 flex flex-col gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <IntegrationKindNav value={kindFilter} onChange={setKindFilter} />
          <div className="flex flex-wrap items-center gap-3">
          <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
            <TabsList className="h-8">
              <TabsTrigger value="all" className="text-xs px-2.5">
                {t('integrations.filters.statusAll', { defaultValue: 'All statuses' })}
              </TabsTrigger>
              <TabsTrigger value="connected" className="text-xs px-2.5">
                {t('integrations.filters.connected')}
              </TabsTrigger>
              <TabsTrigger value="available" className="text-xs px-2.5">
                {t('integrations.filters.available')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative w-full sm:w-72">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
              placeholder={t('integrations.marketplace.searchPlaceholder')}
            />
          </div>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title={
            kindFilter === 'all'
              ? t('integrations.marketplace.empty')
              : t('integrations.marketplace.emptyKind')
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(({ integration, connectionCount }) => (
            <ProviderCard
              key={integration.id}
              integration={integration}
              connectionCount={connectionCount}
              onSetup={() => void handleSetup(integration.id)}
              onViewConnected={() => handleViewConnected(integration)}
              onSetupInMcp={
                (integration.kind ?? resolveIntegrationKind(integration.id)) === 'mcp'
                  ? () => handleSetupInMcp(integration)
                  : undefined
              }
              onAddAccount={
                integration.id === 'github' && connectionCount > 0
                  ? () => void handleSetup('github')
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </PageContent>
  )
}
