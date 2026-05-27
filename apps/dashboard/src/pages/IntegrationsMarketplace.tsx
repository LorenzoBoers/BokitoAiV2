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
  type IntegrationProviderRow,
  type ProvidersListResponse,
} from '../lib/integrations-api'
import { parseIntegrationCallback } from '../lib/integrations-oauth'
import { parseOAuthCallback, describeOAuthCallbackSummary } from '../lib/email-oauth'
import { listGithubConnections } from '../lib/github-api'
import { resolveIntegrationKind } from '../lib/integration-kind'
import {
  parseKindFilter,
  kindFilterToParam,
  connectedPathWithKind,
  type IntegrationKindFilter,
} from '../lib/integration-kind-url'
import {
  parseHubConnectParam,
  stripOAuthCallbackParams,
  type IntegrationHubStep,
} from '../lib/integration-setup-url'
import { integrationIdToPlatformSlug } from '../lib/integration-setup'
import {
  getRegistryEntryByStaticId,
  SLUG_TO_STATIC_ID,
} from '../lib/integrations/registry'
import { applyBrandToIntegration, resolveProviderBrand } from '../lib/integration-brand'
import { ProviderCard } from '../components/integrations/ProviderCard'
import {
  IntegrationHubDialog,
  type HubBanner,
} from '../components/integrations/IntegrationHubDialog'
import { IntegrationKindNav } from '../components/integrations/IntegrationKindNav'
import { Input } from '../components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import { EmptyState } from '../components/ui/empty-state'
import { PageContent } from '../components/layout/PageContent'

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

  const [hubOpen, setHubOpen] = useState(false)
  const [hubIntegration, setHubIntegration] = useState<Integration | null>(null)
  const [hubStep, setHubStep] = useState<IntegrationHubStep>('detail')
  const [hubBanner, setHubBanner] = useState<HubBanner>(null)

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

  const findProviderForIntegration = useCallback(
    (integration: Integration): IntegrationProviderRow | undefined => {
      const slug = integrationIdToPlatformSlug(integration.id)
      return providers.find((p) => p.slug === slug || SLUG_TO_STATIC_ID[p.slug] === integration.id)
    },
    [providers],
  )

  const openHub = useCallback(
    (integration: Integration, step: IntegrationHubStep = 'detail') => {
      setHubIntegration(integration)
      setHubStep(step)
      setHubOpen(true)
    },
    [],
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

  const applyCallbackBanner = useCallback(
    (params: URLSearchParams, connectId: string | null) => {
      const githubCb = parseIntegrationCallback(params)
      const emailCb = parseOAuthCallback(params)

      if (githubCb.handled) {
        if (githubCb.error) {
          setHubBanner({ type: 'error', message: githubCb.error })
        } else if (githubCb.connected) {
          setHubBanner({ type: 'success', message: t('integrations.hub.setup.successGithub') })
        }
        const id = connectId ?? 'github'
        const match = items.find((i) => i.id === id)
        if (match) openHub(match, 'detail')
        return true
      }

      if (emailCb.handled && connectId) {
        const match = items.find((i) => i.id === connectId)
        if (emailCb.error) {
          setHubBanner({
            type: 'error',
            message: describeOAuthCallbackSummary(emailCb),
          })
        } else if (emailCb.status === 'connected') {
          setHubBanner({ type: 'success', message: t('integrations.hub.setup.successInbox') })
        }
        if (match) openHub(match, 'detail')
        return true
      }

      return false
    },
    [items, openHub, t],
  )

  useEffect(() => {
    void refreshCatalog()
  }, [refreshCatalog])

  useEffect(() => {
    if (items.length === 0) return

    const params = new URLSearchParams(window.location.search)
    const { integrationId, step } = parseHubConnectParam(params)
    const hadCallback = applyCallbackBanner(params, integrationId)

    const cleaned = stripOAuthCallbackParams(params)
    if (hadCallback || integrationId) {
      const match = items.find((i) => i.id === integrationId)
      if (match && !hadCallback) {
        openHub(match, step)
      }
      if (integrationId) {
        cleaned.set('connect', integrationId)
        if (step === 'setup') cleaned.set('step', 'setup')
      }
      setSearchParams(cleaned, { replace: true })
    }
  }, [items, applyCallbackBanner, openHub, setSearchParams])

  const handleViewConnected = (integration: Integration) => {
    const kind = integration.kind ?? resolveIntegrationKind(integration.id)
    navigate(connectedPathWithKind(kind))
  }

  const hubConnectionCount = hubIntegration
    ? connectionCountForItem(
        hubIntegration,
        connectionCounts,
        providers,
        githubConnections.length,
      )
    : 0

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
              onOpenDetail={() => openHub(integration, 'detail')}
              onSetup={() => openHub(integration, 'setup')}
              onViewConnected={() => handleViewConnected(integration)}
              onAddAccount={
                integration.id === 'github' && connectionCount > 0
                  ? () => openHub(integration, 'setup')
                  : undefined
              }
            />
          ))}
        </div>
      )}

      <IntegrationHubDialog
        key={hubIntegration ? `${hubIntegration.id}-${hubStep}` : 'closed'}
        open={hubOpen}
        onOpenChange={(open) => {
          setHubOpen(open)
          if (!open) {
            setHubBanner(null)
            const params = new URLSearchParams(searchParams)
            params.delete('connect')
            params.delete('step')
            setSearchParams(params, { replace: true })
          }
        }}
        integration={hubIntegration}
        provider={hubIntegration ? findProviderForIntegration(hubIntegration) : null}
        connectionCount={hubConnectionCount}
        initialStep={hubStep}
        banner={hubBanner}
        onViewConnected={() => {
          if (hubIntegration) handleViewConnected(hubIntegration)
        }}
        onAddAccount={
          hubIntegration?.id === 'github'
            ? () => setHubStep('setup')
            : undefined
        }
        onSaved={() => void refreshCatalog()}
      />
    </PageContent>
  )
}
