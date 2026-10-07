import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConnectionsNextSteps } from '../components/integrations/ConnectionsNextSteps'
import { ConnectionSections } from '../components/integrations/ConnectionSections'
import { MarketplaceModuleCard } from '../components/integrations/ModuleCard'
import { ApplicationCard } from '../components/integrations/ApplicationCard'
import { IntegrationKindNav } from '../components/integrations/IntegrationKindNav'
import {
  ApplicationHubDialog,
  type ApplicationHubStep,
  type HubBanner,
} from '../components/integrations/ApplicationHubDialog'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { useConfirm } from '../components/ui/confirm-dialog'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { PageContent } from '../components/layout/PageContent'
import ContentHeader from '../components/shell/ContentHeader'
import IntegrationsTabs from '../components/shell/IntegrationsTabs'
import { useConnectedIntegrationsSummary } from '../hooks/useConnectedIntegrationsSummary'
import { useIntegrationCatalog } from '../hooks/useIntegrationCatalog'
import {
  parseKindFilter,
  kindFilterToParam,
  readLastIntegrationKind,
  writeLastIntegrationKind,
  connectedPathWithKind,
  type IntegrationKindFilter,
} from '../lib/integration-kind-url'
import {
  filterConnectionItems,
  groupConnectionItems,
  type ConnectionListItem,
} from '../lib/connection-list'
import {
  filterOfferRows,
  flattenApplicationOffers,
  resolveApplicationConnectTarget,
  type IntegrationApplication,
  type IntegrationOffer,
} from '../lib/integration-applications'
import { resolveIntegrationKind } from '../lib/integration-kind'
import { moduleIsOn } from '../lib/integration-modules'
import { applicationsForModule } from '../lib/module-applications'
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

function hubStepFromLegacy(step: IntegrationHubStep, offer?: IntegrationOffer): ApplicationHubStep {
  if (!offer) return 'app'
  return step === 'setup' ? 'offer-setup' : 'offer-detail'
}

export default function ConnectionsHub() {
  const { t } = useTranslation('nav')
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const kindFromUrl = searchParams.get('kind')
  const kindFilter = kindFromUrl == null ? readLastIntegrationKind() : parseKindFilter(kindFromUrl)
  const [query, setQuery] = useState('')

  const { loading, loadError, mcpRows, connections, counts, refresh } = useConnectedIntegrationsSummary()
  const { applications, modules, refreshCatalog, runModuleAction } = useIntegrationCatalog()

  const [hubOpen, setHubOpen] = useState(false)
  const [hubApplication, setHubApplication] = useState<IntegrationApplication | null>(null)
  const [hubOffer, setHubOffer] = useState<IntegrationOffer | null>(null)
  const [hubStep, setHubStep] = useState<ApplicationHubStep>('app')
  const [hubBanner, setHubBanner] = useState<HubBanner>(null)

  const setKindFilter = useCallback(
    (next: IntegrationKindFilter) => {
      writeLastIntegrationKind(next)
      const params = new URLSearchParams(searchParams)
      if (kindFilterToParam(next)) params.set('kind', next)
      else params.delete('kind')
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  useEffect(() => {
    if (kindFromUrl == null && kindFilter !== 'all') {
      const params = new URLSearchParams(searchParams)
      params.set('kind', kindFilter)
      setSearchParams(params, { replace: true })
    }
  }, [kindFromUrl, kindFilter, searchParams, setSearchParams])

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
    [applications, openApplicationHub, t],
  )

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
          openApplicationHub(target.app, hubStepFromLegacy(step, target.offer), target.offer ?? null)
        }
      }
      if (connectParam) {
        cleaned.set('connect', connectParam)
        if (step === 'setup') cleaned.set('step', 'setup')
      }
      setSearchParams(cleaned, { replace: true })
    }
  }, [applications, applyCallbackBanner, openApplicationHub, setSearchParams])

  const connectedOffers = useMemo(
    () =>
      filterOfferRows(
        flattenApplicationOffers(applications).filter((row) => row.offer.connectionCount > 0),
        kindFilter,
        query,
        t,
      ),
    [applications, kindFilter, query, t],
  )

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
    const filtered = filterConnectionItems(rows, query)
    if (kindFilter !== 'all' && kindFilter !== 'mcp') return []
    return filtered
  }, [applications, connections, kindFilter, mcpRows, query])

  const mcpGroups = useMemo(() => groupConnectionItems(mcpItems), [mcpItems])
  const installedModules = useMemo(
    () => modules.filter((module) => module.status !== 'coming_soon' && moduleIsOn(module)),
    [modules],
  )
  const hasInstalledModule = installedModules.length > 0

  const refreshAll = useCallback(async () => {
    await Promise.all([refresh(), refreshCatalog()])
  }, [refresh, refreshCatalog])

  const handleDisconnect = async (item: ConnectionListItem) => {
    if (item.source !== 'mcp') return
    if (!(await confirm({ description: t('integrations.actions.disconnectConfirm'), destructive: true }))) return
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
    if (kind === 'calendar') {
      navigate('/agenda')
      return
    }
    navigate(connectedPathWithKind(kind))
  }

  const openProgram = (programKey: string) => {
    const target = resolveApplicationConnectTarget(applications, programKey)
    if (target) {
      openApplicationHub(target.app, 'offer-setup', target.offer ?? null)
    }
  }

  return (
    <PageContent width="xl" className="space-y-8">
      <ContentHeader
        guide="integrations"
        title={t('tabs.modules.title', { defaultValue: 'Connections' })}
        subtitle={t('integrations.pageMeta.connected.description')}
        className="mb-0"
      />
      <IntegrationsTabs />

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold text-text-muted">
              {t('integrations.connected.installedModulesTitle', {
                defaultValue: 'Installed modules',
              })}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-text-secondary">
              {t('integrations.connected.installedModulesHint', {
                defaultValue: 'Domain presets that are on for this workspace.',
              })}
            </p>
          </div>
          <Button size="sm" variant="ghost" asChild>
            <Link to="/connections/marketplace">
              {t('integrations.modules.browseMarketplace', {
                defaultValue: 'Browse marketplace',
              })}
            </Link>
          </Button>
        </div>
        {modules.length === 0 ? (
          <CardGridSkeleton cards={2} />
        ) : installedModules.length === 0 ? (
          <p className="text-sm text-text-muted">
            {t('integrations.connected.noInstalledModules', {
              defaultValue: 'No modules installed yet. Discover presets on the marketplace.',
            })}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {installedModules.map((module) => (
              <MarketplaceModuleCard
                key={module.slug}
                module={module}
                applications={applicationsForModule(applications, module)}
                onAction={runModuleAction}
              />
            ))}
          </div>
        )}
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <IntegrationKindNav value={kindFilter} onChange={setKindFilter} />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('integrations.connected.searchPlaceholder')}
          className="h-8 w-full sm:w-64 text-sm"
        />
      </div>

      {loadError ? <p className="text-xs text-text-muted">{t(loadError)}</p> : null}

      <ConnectionsNextSteps
        needsChannel={counts.inbox === 0}
        needsAgenda={counts.calendar === 0}
        needsModule={!hasInstalledModule}
      />

      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-text-muted">{t('integrations.connected.yourList')}</h2>
        {loading && applications.length === 0 ? (
          <CardGridSkeleton />
        ) : connectedOffers.length === 0 ? (
          <p className="text-sm text-text-muted">
            {query.trim()
              ? t('integrations.connected.noSearchMatches')
              : t('integrations.connected.emptyAllDescription')}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {connectedOffers.map(({ application, offer }) => (
              <ApplicationCard
                key={`${application.hostSlug}:${offer.integration.id}`}
                application={application}
                offer={offer}
                onOpenDetail={() => openApplicationHub(application, 'offer-detail', offer)}
              />
            ))}
          </div>
        )}
      </section>

      <ConnectionSections
        title={t('integrations.connected.mcpServersTitle', {
          defaultValue: 'Custom MCP servers',
        })}
        loading={loading}
        groups={mcpGroups}
        emptyLabel={
          query.trim()
            ? t('integrations.connected.noSearchMatches')
            : t('integrations.connected.emptyMcpDescription', {
                defaultValue: 'No custom MCP servers connected yet.',
              })
        }
        onOpenProgram={openProgram}
        onAttach={handleAttach}
        onDisconnect={handleDisconnect}
        hideKindHeading
      />

      <section className="rounded-lg border border-dashed border-border/60 px-4 py-3">
        <p className="text-sm text-text-secondary">
          {t('integrations.connected.marketplaceHint', {
            defaultValue: 'Looking for something else? Add modules and connections on the marketplace.',
          })}
        </p>
        <Button size="sm" variant="secondary" className="mt-2" asChild>
          <Link to="/connections/marketplace">
            {t('integrations.modules.browseMarketplace', { defaultValue: 'Browse marketplace' })}
          </Link>
        </Button>
      </section>

      <ApplicationHubDialog
        open={hubOpen}
        onOpenChange={setHubOpen}
        application={hubApplication}
        initialStep={hubStep}
        initialOfferId={hubOffer?.integration.id ?? null}
        banner={hubBanner}
        modules={modules}
        onViewConnected={handleViewConnected}
        onSaved={() => void refreshAll()}
      />
    </PageContent>
  )
}
