import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Search } from 'lucide-react'
import { CalendarAccountsSection } from '../components/integrations/CalendarAccountsSection'
import { ConnectionSections } from '../components/integrations/ConnectionSections'
import { MarketplaceModuleCard } from '../components/integrations/ModuleCard'
import { ModuleShowcaseModal } from '../components/integrations/ModuleShowcaseModal'
import { ApplicationCard } from '../components/integrations/ApplicationCard'
import { AiToolCard } from '../components/integrations/AiToolCard'
import { ConnectedTile } from '../components/integrations/ConnectedTile'
import { IntegrationHostLogo } from '../components/integrations/IntegrationHostLogo'
import { IntegrationKindNav } from '../components/integrations/IntegrationKindNav'
import {
  ApplicationHubPanel,
  type ApplicationHubStep,
  type HubBanner,
} from '../components/integrations/ApplicationHubPanel'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { IconTile } from '../components/ui/icon-tile'
import { EmptyState } from '../components/ui/empty-state'
import { useConfirm } from '../components/ui/confirm-dialog'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { PageContent } from '../components/layout/PageContent'
import ContentHeader from '../components/shell/ContentHeader'
import { useConnectedIntegrationsSummary } from '../hooks/useConnectedIntegrationsSummary'
import { useIntegrationCatalog } from '../hooks/useIntegrationCatalog'
import {
  parseKindFilter,
  kindFilterToParam,
  connectionsPathWithKind,
  type IntegrationKindFilter,
} from '../lib/integration-kind-url'
import {
  filterConnectionItems,
  groupConnectionItems,
  type ConnectionListItem,
} from '../lib/connection-list'
import {
  effectiveOfferKind,
  filterOfferRows,
  localizeOfferCopy,
  resolveApplicationConnectTarget,
  type IntegrationApplication,
  type IntegrationOffer,
} from '../lib/integration-applications'
import { resolveIntegrationKind } from '../lib/integration-kind'
import { moduleHomePath, moduleIsOn, moduleNavIcon } from '../lib/integration-modules'
import {
  applicationsForModule,
  marketplaceOfferRows,
  moduleForPackageSlug,
  moduleMatchesMarketplaceQuery,
} from '../lib/module-applications'
import {
  parseHubConnectParam,
  stripOAuthCallbackParams,
  type IntegrationHubStep,
} from '../lib/integration-setup-url'
import { parseIntegrationCallback } from '../lib/integrations-oauth'
import { parseOAuthCallback, describeOAuthCallbackSummary } from '../lib/email-oauth'
import { SLUG_TO_STATIC_ID } from '../lib/integrations/registry'
import { revokeMcpConnection } from '../lib/mcp-integrations'
import { attachModuleConnection } from '../lib/module-api'
import { aiToolCardRows, filterAiToolRows, type AiToolCardRow } from '../lib/ai-tool-providers'
import type { IntegrationModuleRow } from '../lib/integrations-api'

function hubStepFromLegacy(step: IntegrationHubStep, offer?: IntegrationOffer): ApplicationHubStep {
  if (!offer) return 'app'
  return step === 'setup' ? 'offer-setup' : 'offer-detail'
}

const AI_TOOL_ROWS = aiToolCardRows()

type GridItem =
  | { kind: 'module'; key: string; module: IntegrationModuleRow }
  | { kind: 'offer'; key: string; application: IntegrationApplication; offer: IntegrationOffer }
  | { kind: 'ai_tool'; key: string; row: AiToolCardRow }

/**
 * Connections: one page for everything the workspace can talk to. A Connected
 * strip on top, then one searchable grid of modules, integrations and AI tools.
 * Detail and setup open in a right-hand panel; `?connect={slug}` deep-links it.
 */
export default function ConnectionsHub() {
  const { t } = useTranslation(['nav', 'common'])
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const kindFilter = parseKindFilter(searchParams.get('kind'))
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')

  const { loading, loadError, mcpRows, connections, refresh } = useConnectedIntegrationsSummary()
  const { applications, modules, loadError: catalogError, refreshCatalog, runModuleAction } =
    useIntegrationCatalog()

  const [hubOpen, setHubOpen] = useState(false)
  const [hubApplication, setHubApplication] = useState<IntegrationApplication | null>(null)
  const [hubOffer, setHubOffer] = useState<IntegrationOffer | null>(null)
  const [hubStep, setHubStep] = useState<ApplicationHubStep>('app')
  const [hubBanner, setHubBanner] = useState<HubBanner>(null)
  const [moduleShowcase, setModuleShowcase] = useState<IntegrationModuleRow | null>(null)

  const setKindFilter = useCallback(
    (next: IntegrationKindFilter) => {
      const params = new URLSearchParams(searchParams)
      const param = kindFilterToParam(next)
      if (param) params.set('kind', param)
      else params.delete('kind')
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const setSearchQuery = useCallback(
    (next: string) => {
      setQuery(next)
      const params = new URLSearchParams(searchParams)
      if (next.trim()) params.set('q', next)
      else params.delete('q')
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams],
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

  const closeApplicationHub = useCallback(
    (open: boolean) => {
      setHubOpen(open)
      if (open) return
      setHubBanner(null)
      setHubOffer(null)
      const params = new URLSearchParams(window.location.search)
      if (params.has('connect') || params.has('step')) {
        params.delete('connect')
        params.delete('step')
        setSearchParams(params, { replace: true })
      }
    },
    [setSearchParams],
  )

  const applyCallbackBanner = useCallback(
    (params: URLSearchParams, connectParam: string | null) => {
      const integrationCb = parseIntegrationCallback(params)
      const emailCb = parseOAuthCallback(params)

      if (integrationCb.handled) {
        const slug = integrationCb.provider ?? 'github'
        const staticId = SLUG_TO_STATIC_ID[slug] ?? slug
        const isGithub =
          slug === 'github' || params.get('github') === 'connected' || staticId === 'github'
        const packageModule = moduleForPackageSlug(modules, connectParam ?? slug)
        if (packageModule) {
          if (integrationCb.error) {
            toast.error(integrationCb.error)
          } else if (integrationCb.connected) {
            toast.success(
              integrationCb.reused
                ? t('integrations.connections.reused')
                : t('integrations.hub.setup.successRemoteMcp'),
            )
          }
          navigate(moduleHomePath(packageModule))
          return true
        }
        if (integrationCb.error) {
          setHubBanner({ type: 'error', message: integrationCb.error })
        } else if (integrationCb.connected) {
          setHubBanner({
            type: 'success',
            message: integrationCb.reused
              ? t('integrations.connections.reused')
              : isGithub
                ? t('integrations.hub.setup.successGithub')
                : t('integrations.hub.setup.successRemoteMcp'),
          })
        }
        const target = resolveApplicationConnectTarget(applications, connectParam ?? staticId)
        if (target) {
          openApplicationHub(target.app, target.offer ? 'offer-detail' : 'app', target.offer ?? null)
        }
        return true
      }

      if (emailCb.handled && connectParam) {
        const target = resolveApplicationConnectTarget(applications, connectParam)
        if (emailCb.error) {
          setHubBanner({ type: 'error', message: describeOAuthCallbackSummary(emailCb) })
        } else if (emailCb.status === 'connected') {
          setHubBanner({ type: 'success', message: t('integrations.hub.setup.successInbox') })
        }
        if (target) {
          openApplicationHub(target.app, target.offer ? 'offer-detail' : 'app', target.offer ?? null)
        }
        return true
      }

      return false
    },
    [applications, modules, navigate, openApplicationHub, t],
  )

  useEffect(() => {
    if (applications.length === 0) return
    const params = new URLSearchParams(window.location.search)
    const { integrationId: connectParam, step } = parseHubConnectParam(params)
    const packageModule = connectParam ? moduleForPackageSlug(modules, connectParam) : null
    const hadCallback = applyCallbackBanner(params, connectParam)
    const cleaned = stripOAuthCallbackParams(params)
    if (packageModule) {
      cleaned.delete('connect')
      cleaned.delete('step')
      setSearchParams(cleaned, { replace: true })
      if (!hadCallback) navigate(moduleHomePath(packageModule))
      return
    }
    if (hadCallback || connectParam) {
      if (!hadCallback && connectParam) {
        const target = resolveApplicationConnectTarget(applications, connectParam)
        if (target) {
          openApplicationHub(target.app, hubStepFromLegacy(step, target.offer), target.offer ?? null)
        }
      }
      if (connectParam) {
        cleaned.set('connect', connectParam)
        if (step === 'setup') cleaned.set('step', 'setup')
      }
      setSearchParams(cleaned, { replace: true })
    }
  }, [applications, applyCallbackBanner, modules, navigate, openApplicationHub, setSearchParams])

  const allOfferRows = useMemo(
    () => marketplaceOfferRows(applications, modules),
    [applications, modules],
  )

  const connectedOffers = useMemo(
    () => filterOfferRows(allOfferRows.filter((row) => row.offer.connectionCount > 0), 'all', '', t),
    [allOfferRows, t],
  )

  const installedModules = useMemo(
    () => modules.filter((module) => module.status !== 'coming_soon' && moduleIsOn(module)),
    [modules],
  )

  /** Custom MCP servers that no catalog offer already accounts for. */
  const mcpItems = useMemo((): ConnectionListItem[] => {
    const summaryById = Object.fromEntries(connections.map((row) => [row.id, row]))
    const rows: ConnectionListItem[] = []
    for (const row of mcpRows) {
      const target = resolveApplicationConnectTarget(applications, row.providerSlug)
      if (target?.offer && target.offer.connectionCount > 0) continue
      const summary = summaryById[row.id]
      rows.push({
        id: row.id,
        kind: 'mcp',
        programKey: row.providerSlug,
        programName: row.providerName,
        title: row.displayName,
        subtitle: row.endpoint,
        brand: {
          name: row.providerName,
          initials: row.initials,
          color: row.brandColor,
          logoUrl: row.logoUrl ?? null,
          logoDarkUrl: row.logoDarkUrl ?? null,
          hostSlug: row.hostSlug ?? null,
        },
        attachedModules: summary?.attached_modules ?? [],
        eligibleModule: summary?.eligible_module ?? null,
        source: 'mcp',
        connectionId: row.id,
      })
    }
    if (kindFilter !== 'all' && kindFilter !== 'mcp') return []
    return filterConnectionItems(rows, query)
  }, [applications, connections, kindFilter, mcpRows, query])

  const mcpGroups = useMemo(() => groupConnectionItems(mcpItems), [mcpItems])

  const visibleModules = useMemo(() => {
    if (kindFilter !== 'all' && kindFilter !== 'modules') return []
    const filtered = modules.filter((module) =>
      moduleMatchesMarketplaceQuery(module, applications, query, t),
    )
    return filtered.sort((a, b) => {
      const rank = (m: IntegrationModuleRow) => (m.status === 'coming_soon' ? 2 : moduleIsOn(m) ? 0 : 1)
      const byRank = rank(a) - rank(b)
      if (byRank !== 0) return byRank
      const aName = t(`integrations.modules.${a.slug}.name`, { defaultValue: a.name })
      const bName = t(`integrations.modules.${b.slug}.name`, { defaultValue: b.name })
      return aName.localeCompare(bName)
    })
  }, [applications, kindFilter, modules, query, t])

  const visibleOffers = useMemo(
    () => filterOfferRows(allOfferRows, kindFilter, query, t),
    [allOfferRows, kindFilter, query, t],
  )

  const visibleAiTools = useMemo(() => {
    if (kindFilter !== 'all' && kindFilter !== 'ai_tools') return []
    return filterAiToolRows(AI_TOOL_ROWS, query, t)
  }, [kindFilter, query, t])

  const gridItems = useMemo((): GridItem[] => {
    const items: GridItem[] = []
    for (const module of visibleModules) {
      items.push({ kind: 'module', key: `module:${module.slug}`, module })
    }
    for (const { application, offer } of visibleOffers) {
      items.push({
        kind: 'offer',
        key: `offer:${application.hostSlug}:${offer.integration.id}`,
        application,
        offer,
      })
    }
    for (const row of visibleAiTools) {
      items.push({ kind: 'ai_tool', key: row.key, row })
    }
    return items
  }, [visibleAiTools, visibleModules, visibleOffers])

  const counts = useMemo(() => {
    const byKind: Partial<Record<IntegrationKindFilter, number>> = {
      modules: modules.length,
      ai_tools: AI_TOOL_ROWS.length,
    }
    for (const row of allOfferRows) {
      const lane = effectiveOfferKind(row.offer)
      byKind[lane] = (byKind[lane] ?? 0) + 1
    }
    return byKind
  }, [allOfferRows, modules.length])

  const refreshAll = useCallback(async () => {
    await Promise.all([refresh(), refreshCatalog()])
  }, [refresh, refreshCatalog])

  const handleDisconnect = async (item: ConnectionListItem) => {
    if (item.source !== 'mcp') return
    if (
      !(await confirm({
        description: t('integrations.actions.disconnectConfirm'),
        confirmLabel: t('actions.disconnect', { ns: 'common' }),
        destructive: true,
      }))
    )
      return
    try {
      await revokeMcpConnection(item.connectionId)
      toast.success(t('integrations.actions.disconnected'))
      await refreshAll()
    } catch {
      toast.error(t('integrations.actions.disconnectFailed'))
    }
  }

  const handleAttach = async (row: ConnectionListItem) => {
    const moduleSlug = row.eligibleModule
    if (!moduleSlug) return
    try {
      await attachModuleConnection(moduleSlug, row.connectionId)
      toast.success(
        t('integrations.connected.attached', {
          name: t(`integrations.modules.${moduleSlug}.name`, { defaultValue: moduleSlug }),
        }),
      )
      await refreshAll()
    } catch {
      toast.error(t('integrations.connected.attachFailed'))
    }
  }

  const handleViewConnected = (offer: IntegrationOffer) => {
    const kind = offer.kind ?? resolveIntegrationKind(offer.integration.id)
    if (kind === 'inbox') {
      navigate('/settings/channels')
      return
    }
    setHubOpen(false)
    navigate(connectionsPathWithKind(kind))
  }

  const openProgram = (programKey: string) => {
    const packageModule = moduleForPackageSlug(modules, programKey)
    if (packageModule) {
      navigate(moduleHomePath(packageModule))
      return
    }
    const target = resolveApplicationConnectTarget(applications, programKey)
    if (target) {
      openApplicationHub(target.app, 'offer-setup', target.offer ?? null)
    }
  }

  const showConnectedStrip =
    kindFilter === 'all' && !query.trim() && (connectedOffers.length > 0 || installedModules.length > 0)
  const hasActiveFilter = Boolean(query.trim()) || kindFilter !== 'all'
  const catalogLoading = loading && applications.length === 0

  return (
    <PageContent width="xl" className="space-y-8">
      <ContentHeader
        guide="integrations"
        title={t('tabs.modules.title', { defaultValue: 'Connections' })}
        subtitle={t('integrations.pageMeta.connected.description')}
        className="mb-0"
      />

      {loadError || catalogError ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-text-muted">{loadError ? t(loadError) : catalogError}</p>
          <Button type="button" size="sm" variant="ghost" onClick={() => void refreshAll()}>
            {t('actions.retry', { ns: 'common' })}
          </Button>
        </div>
      ) : null}

      {showConnectedStrip ? (
        <section className="space-y-3" aria-labelledby="connections-connected">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="connections-connected" className="text-xs font-semibold text-text-muted">
              {t('integrations.connectedStrip.title', { defaultValue: 'Connected' })}
            </h2>
            <p className="text-2xs text-text-muted">
              {t('integrations.connectedStrip.count', {
                count: connectedOffers.length + installedModules.length,
                defaultValue: '{{count}} active',
              })}
            </p>
          </div>
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]">
            {installedModules.map((module) => {
              const Icon = moduleNavIcon(module.slug)
              const specialist = module.specialist_agent_name
              return (
                <ConnectedTile
                  key={`module:${module.slug}`}
                  mark={<IconTile icon={Icon} />}
                  name={t(`integrations.modules.${module.slug}.name`, { defaultValue: module.name })}
                  meta={
                    specialist
                      ? t('integrations.connectedStrip.specialistMeta', {
                          defaultValue: 'Specialist · {{name}}',
                          name: specialist,
                        })
                      : t('integrations.filters.modules')
                  }
                  onClick={() =>
                    navigate(
                      specialist && module.specialist_agent_id
                        ? moduleHomePath(module) + '?tab=setup'
                        : moduleHomePath(module),
                    )
                  }
                />
              )
            })}
            {connectedOffers.map(({ application, offer }) => {
              const copy = localizeOfferCopy(offer, t)
              return (
                <ConnectedTile
                  key={`offer:${application.hostSlug}:${offer.integration.id}`}
                  mark={
                    <IntegrationHostLogo
                      logoUrl={application.brand.logoUrl}
                      logoDarkUrl={application.brand.logoDarkUrl}
                      initials={application.brand.initials}
                      color={application.brand.color}
                      name={copy.name}
                      hostSlug={application.brand.hostSlug}
                      size="md"
                    />
                  }
                  name={copy.name}
                  meta={t('integrations.connectedStrip.connections', {
                    count: offer.connectionCount,
                    defaultValue: '{{count}} connections',
                  })}
                  onClick={() => openApplicationHub(application, 'offer-detail', offer)}
                />
              )
            })}
          </div>
        </section>
      ) : null}

      <section className="space-y-4" aria-labelledby="connections-all">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h2 id="connections-all" className="text-xs font-semibold text-text-muted">
              {t('integrations.filters.all')}
            </h2>
            <IntegrationKindNav
              value={kindFilter}
              onChange={setKindFilter}
              counts={counts}
              className="mt-2"
            />
          </div>
          <div className="relative w-full lg:w-72">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <Input
              value={query}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 pl-9 text-sm"
              placeholder={t('integrations.marketplace.searchPlaceholder')}
              aria-label={t('integrations.marketplace.searchPlaceholder')}
            />
          </div>
        </div>

        {kindFilter === 'calendar' ? <CalendarAccountsSection /> : null}

        {catalogLoading ? (
          <CardGridSkeleton />
        ) : gridItems.length === 0 ? (
          <EmptyState
            icon={Search}
            title={
              hasActiveFilter
                ? t('integrations.marketplace.emptyFiltered')
                : t('integrations.marketplace.empty')
            }
            action={
              hasActiveFilter ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setSearchQuery('')
                    setKindFilter('all')
                  }}
                >
                  {t('integrations.marketplace.clearFilters')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {gridItems.map((item) => {
              if (item.kind === 'module') {
                return (
                  <MarketplaceModuleCard
                    key={item.key}
                    module={item.module}
                    applications={applicationsForModule(applications, item.module)}
                    onAction={runModuleAction}
                    onOpenDetail={() => setModuleShowcase(item.module)}
                    showKindBadge
                  />
                )
              }
              if (item.kind === 'offer') {
                return (
                  <ApplicationCard
                    key={item.key}
                    application={item.application}
                    offer={item.offer}
                    onOpenDetail={() => openApplicationHub(item.application, 'offer-detail', item.offer)}
                  />
                )
              }
              return <AiToolCard key={item.key} row={item.row} />
            })}
          </div>
        )}
      </section>

      {mcpGroups.length > 0 ? (
        <ConnectionSections
          title={t('integrations.connected.mcpServersTitle', { defaultValue: 'Custom MCP servers' })}
          loading={loading}
          groups={mcpGroups}
          emptyLabel={t('integrations.connected.noSearchMatches')}
          onOpenProgram={openProgram}
          onAttach={handleAttach}
          onDisconnect={handleDisconnect}
          hideKindHeading
        />
      ) : null}

      <ApplicationHubPanel
        key={
          hubApplication
            ? `${hubApplication.hostSlug}-${hubOffer?.integration.id ?? 'app'}-${hubStep}`
            : 'closed'
        }
        open={hubOpen}
        onOpenChange={closeApplicationHub}
        application={hubApplication}
        initialStep={hubStep}
        initialOfferId={hubOffer?.integration.id ?? null}
        banner={hubBanner}
        modules={modules}
        onViewConnected={handleViewConnected}
        onSaved={() => void refreshAll()}
      />

      <ModuleShowcaseModal
        open={Boolean(moduleShowcase)}
        onOpenChange={(open) => {
          if (!open) setModuleShowcase(null)
        }}
        module={moduleShowcase}
        applications={
          moduleShowcase ? applicationsForModule(applications, moduleShowcase) : []
        }
        onAction={async (slug, action) => {
          await runModuleAction(slug, action)
          await refreshCatalog()
        }}
      />
    </PageContent>
  )
}
