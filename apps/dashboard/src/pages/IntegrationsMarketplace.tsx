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
  parseStatusFilter,
  type IntegrationKindFilter,
  type MarketplaceStatusFilter,
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
import {
  buildIntegrationApplications,
  localizeApplication,
  resolveApplicationConnectTarget,
  type IntegrationApplication,
  type IntegrationOffer,
} from '../lib/integration-applications'
import { ApplicationCard } from '../components/integrations/ApplicationCard'
import {
  ApplicationHubDialog,
  type ApplicationHubStep,
} from '../components/integrations/ApplicationHubDialog'
import type { HubBanner } from '../components/integrations/IntegrationHubDialog'
import { IntegrationKindNav } from '../components/integrations/IntegrationKindNav'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import { EmptyState } from '../components/ui/empty-state'
import { PageContent } from '../components/layout/PageContent'
import IntegrationsTabs from '../components/shell/IntegrationsTabs'

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

function hubStepFromLegacy(step: IntegrationHubStep, offer?: IntegrationOffer): ApplicationHubStep {
  if (!offer) return 'app'
  return step === 'setup' ? 'offer-setup' : 'offer-detail'
}

export default function IntegrationsMarketplace() {
  const { t } = useTranslation(['nav', 'common'])
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const kindFilter = parseKindFilter(searchParams.get('kind'))
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
  const statusFilter = parseStatusFilter(searchParams.get('status'))
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
  const [hubApplication, setHubApplication] = useState<IntegrationApplication | null>(null)
  const [hubOffer, setHubOffer] = useState<IntegrationOffer | null>(null)
  const [hubStep, setHubStep] = useState<ApplicationHubStep>('app')
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

  const setStatusFilter = useCallback(
    (next: MarketplaceStatusFilter) => {
      const params = new URLSearchParams(searchParams)
      if (next === 'all') params.delete('status')
      else params.set('status', next)
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const setSearchQuery = useCallback(
    (next: string) => {
      setSearch(next)
      const params = new URLSearchParams(searchParams)
      if (next.trim()) params.set('q', next)
      else params.delete('q')
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

  const openApplicationHub = useCallback(
    (
      app: IntegrationApplication,
      step: ApplicationHubStep = 'app',
      offer: IntegrationOffer | null = null,
    ) => {
      setHubApplication(app)
      setHubOffer(offer)
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
      setLoadError(t('integrations.marketplace.catalogFallback', { defaultValue: 'Catalog API unavailable; using local list.' }))
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

  const applyCallbackBanner = useCallback(
    (params: URLSearchParams, connectParam: string | null) => {
      const integrationCb = parseIntegrationCallback(params)
      const emailCb = parseOAuthCallback(params)

      if (integrationCb.handled) {
        const slug = integrationCb.provider ?? 'github'
        const staticId = SLUG_TO_STATIC_ID[slug] ?? slug
        const isGithub =
          slug === 'github' || params.get('github') === 'connected' || staticId === 'github'
        if (integrationCb.error) {
          setHubBanner({ type: 'error', message: integrationCb.error })
        } else if (integrationCb.connected) {
          setHubBanner({
            type: 'success',
            message: isGithub
              ? t('integrations.hub.setup.successGithub')
              : t('integrations.hub.setup.successRemoteMcp'),
          })
        }
        const id = connectParam ?? staticId
        const target = resolveApplicationConnectTarget(applications, id)
        if (target) {
          openApplicationHub(
            target.app,
            target.offer ? 'offer-detail' : 'app',
            target.offer ?? null,
          )
        }
        return true
      }

      if (emailCb.handled && connectParam) {
        const target = resolveApplicationConnectTarget(applications, connectParam)
        if (emailCb.error) {
          setHubBanner({
            type: 'error',
            message: describeOAuthCallbackSummary(emailCb),
          })
        } else if (emailCb.status === 'connected') {
          setHubBanner({ type: 'success', message: t('integrations.hub.setup.successInbox') })
        }
        if (target) {
          openApplicationHub(
            target.app,
            target.offer ? 'offer-detail' : 'app',
            target.offer ?? null,
          )
        }
        return true
      }

      return false
    },
    [applications, openApplicationHub, t],
  )

  useEffect(() => {
    void refreshCatalog()
  }, [refreshCatalog])

  useEffect(() => {
    if (applications.length === 0) return

    const params = new URLSearchParams(window.location.search)
    const { integrationId: connectParam, step } = parseHubConnectParam(params)
    const hadCallback = applyCallbackBanner(params, connectParam)

    const cleaned = stripOAuthCallbackParams(params)
    if (hadCallback || connectParam) {
      if (!hadCallback && connectParam) {
        const target = resolveApplicationConnectTarget(applications, connectParam)
        if (target) {
          openApplicationHub(
            target.app,
            hubStepFromLegacy(step, target.offer),
            target.offer ?? null,
          )
        }
      }
      if (connectParam) {
        cleaned.set('connect', connectParam)
        if (step === 'setup') cleaned.set('step', 'setup')
      }
      setSearchParams(cleaned, { replace: true })
    }
  }, [applications, applyCallbackBanner, openApplicationHub, setSearchParams])

  const handleViewConnected = (offer: IntegrationOffer) => {
    const kind = offer.kind ?? resolveIntegrationKind(offer.integration.id)
    navigate(connectedPathWithKind(kind))
  }

  const filtered = useMemo(() => {
    let list = [...applications]

    if (kindFilter !== 'all') {
      list = list.filter((app) => app.kinds.includes(kindFilter))
    }
    if (statusFilter === 'connected') {
      list = list.filter((app) => app.connectionCount > 0)
    }
    if (statusFilter === 'available') {
      list = list.filter((app) => app.connectionCount === 0 && app.status !== 'coming_soon')
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((app) => {
        const localized = localizeApplication(app, t)
        if (localized.name.toLowerCase().includes(q) || localized.description.toLowerCase().includes(q)) {
          return true
        }
        return app.offers.some((offer) => {
          const kind = offer.kind
          return (
            offer.integration.name.toLowerCase().includes(q) ||
            offer.integration.description.toLowerCase().includes(q) ||
            t(`integrations.kind.${kind}`).toLowerCase().includes(q)
          )
        })
      })
    }

    list.sort((a, b) => {
      const aConn = a.connectionCount > 0 ? 0 : 1
      const bConn = b.connectionCount > 0 ? 0 : 1
      if (aConn !== bConn) return aConn - bConn
      return a.name.localeCompare(b.name)
    })

    return list
  }, [applications, kindFilter, statusFilter, search, t])

  const connectedTotal = useMemo(
    () => applications.filter((app) => app.connectionCount > 0).length,
    [applications],
  )

  return (
    <PageContent width="xl">
      <IntegrationsTabs />
      <div className="mb-6">
        <p className="max-w-2xl text-sm text-text-secondary">
          {t('integrations.pageMeta.marketplace.description')}
        </p>
        {loadError ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="text-xs text-text-muted">{loadError}</p>
            <Button type="button" size="sm" variant="ghost" onClick={() => void refreshCatalog()}>
              {t('common:actions.retry')}
            </Button>
          </div>
        ) : null}
        <p className="mt-3 text-xs text-text-muted">
          {t('integrations.marketplace.connectedCount', { count: connectedTotal })}
        </p>
      </div>

      <div className="mb-6 flex flex-col gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <IntegrationKindNav value={kindFilter} onChange={setKindFilter} />
          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as MarketplaceStatusFilter)}>
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
                onChange={(e) => setSearchQuery(e.target.value)}
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
          {filtered.map((application) => (
            <ApplicationCard
              key={application.hostSlug}
              application={application}
              onOpenDetail={() => openApplicationHub(application, 'app')}
            />
          ))}
        </div>
      )}

      <ApplicationHubDialog
        key={
          hubApplication
            ? `${hubApplication.hostSlug}-${hubOffer?.integration.id ?? 'app'}-${hubStep}`
            : 'closed'
        }
        open={hubOpen}
        onOpenChange={(open) => {
          setHubOpen(open)
          if (!open) {
            setHubBanner(null)
            setHubOffer(null)
            const params = new URLSearchParams(searchParams)
            params.delete('connect')
            params.delete('step')
            setSearchParams(params, { replace: true })
          }
        }}
        application={hubApplication}
        initialStep={hubStep}
        initialOfferId={hubOffer?.integration.id ?? null}
        banner={hubBanner}
        onViewConnected={handleViewConnected}
        onSaved={() => void refreshCatalog()}
      />
    </PageContent>
  )
}
