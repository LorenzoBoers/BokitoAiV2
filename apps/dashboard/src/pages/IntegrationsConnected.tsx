import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConnectionsCatalogList } from '../components/integrations/ConnectionsCatalogList'
import { ConnectionsNextSteps } from '../components/integrations/ConnectionsNextSteps'
import { IntegrationHostLogo } from '../components/integrations/IntegrationHostLogo'
import { IntegrationKindNav } from '../components/integrations/IntegrationKindNav'
import {
  ApplicationHubDialog,
  type ApplicationHubStep,
} from '../components/integrations/ApplicationHubDialog'
import type { HubBanner } from '../components/integrations/IntegrationHubDialog'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { PageContent } from '../components/layout/PageContent'
import { PageGuideBanner } from '../components/layout/PageGuideBanner'
import IntegrationsTabs from '../components/shell/IntegrationsTabs'
import { useConnectedIntegrationsSummary } from '../hooks/useConnectedIntegrationsSummary'
import { useIntegrationCatalog } from '../hooks/useIntegrationCatalog'
import { useIntegrationBrand } from '../context/IntegrationBrandContext'
import {
  parseKindFilter,
  kindFilterToParam,
  readLastIntegrationKind,
  writeLastIntegrationKind,
  type IntegrationKindFilter,
} from '../lib/integration-kind-url'
import {
  filterConnectionItems,
  groupConnectionItems,
  type ConnectionListItem,
} from '../lib/connection-list'
import {
  resolveApplicationConnectTarget,
  type IntegrationApplication,
  type IntegrationOffer,
} from '../lib/integration-applications'
import { resolveProviderBrand } from '../lib/integration-brand'
import { moduleIsOn } from '../lib/integration-modules'
import {
  parseHubConnectParam,
  stripOAuthCallbackParams,
  type IntegrationHubStep,
} from '../lib/integration-setup-url'
import { parseIntegrationCallback } from '../lib/integrations-oauth'
import { parseOAuthCallback, describeOAuthCallbackSummary } from '../lib/email-oauth'
import { SLUG_TO_STATIC_ID } from '../lib/integrations/registry'
import { revokeIntegrationConnection, attachModuleConnection } from '../lib/integrations-api'
import { revokeMcpConnection } from '../lib/mcp-integrations'

function hubStepFromLegacy(step: IntegrationHubStep, offer?: IntegrationOffer): ApplicationHubStep {
  if (!offer) return 'app'
  return step === 'setup' ? 'offer-setup' : 'offer-detail'
}

export default function IntegrationsConnected() {
  const { t } = useTranslation('nav')
  const [searchParams, setSearchParams] = useSearchParams()
  const kindFromUrl = searchParams.get('kind')
  const kindFilter = kindFromUrl == null ? readLastIntegrationKind() : parseKindFilter(kindFromUrl)
  const [query, setQuery] = useState('')

  const {
    loading,
    loadError,
    github,
    emailOutlook,
    emailGmail,
    mcpRows,
    calendarRows,
    connections,
    appConnections,
    counts,
    refresh,
  } = useConnectedIntegrationsSummary()
  const { applications, modules, refreshCatalog } = useIntegrationCatalog()

  const githubBrand = useIntegrationBrand('github')
  const outlookBrand = useIntegrationBrand('outlook')
  const gmailBrand = useIntegrationBrand('gmail')

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

  useEffect(() => {
    if (window.location.hash === '#catalog') {
      document.getElementById('catalog')?.scrollIntoView({ block: 'start' })
    }
  }, [loading])

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
            message: isGithub
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

  const items = useMemo((): ConnectionListItem[] => {
    const rows: ConnectionListItem[] = []

    if (emailOutlook > 0) {
      rows.push({
        id: 'inbox-outlook',
        kind: 'inbox',
        programKey: 'microsoft',
        programName: 'Microsoft 365',
        title: t('integrations.connected.mailboxProgram', { count: emailOutlook }),
        subtitle: null,
        brand: outlookBrand,
        attachedModules: [],
        eligibleModule: null,
        source: 'inbox',
        connectionId: 'inbox-outlook',
      })
    }
    if (emailGmail > 0) {
      rows.push({
        id: 'inbox-gmail',
        kind: 'inbox',
        programKey: 'google',
        programName: 'Google',
        title: t('integrations.connected.mailboxProgram', { count: emailGmail }),
        subtitle: null,
        brand: gmailBrand,
        attachedModules: [],
        eligibleModule: null,
        source: 'inbox',
        connectionId: 'inbox-gmail',
      })
    }

    for (const row of calendarRows) {
      const brand = resolveProviderBrand(row.provider)
      rows.push({
        id: row.id,
        kind: 'calendar',
        programKey: row.provider,
        programName: brand.name,
        title: row.display_name,
        subtitle:
          typeof row.event_count === 'number'
            ? t('agendaPage.calendar.eventCount', { count: row.event_count })
            : null,
        brand,
        attachedModules: [],
        eligibleModule: null,
        source: 'calendar',
        connectionId: row.id,
      })
    }

    for (const row of appConnections) {
      const brand = resolveProviderBrand(row.provider)
      rows.push({
        id: row.id,
        kind: 'app',
        programKey: row.provider,
        programName: brand.name,
        title: row.display_name,
        subtitle: null,
        brand,
        attachedModules: row.attached_modules,
        eligibleModule: row.eligible_module,
        source: 'app',
        connectionId: row.id,
      })
    }

    const summaryById = Object.fromEntries(connections.map((row) => [row.id, row]))
    for (const row of mcpRows) {
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

    for (const row of github) {
      rows.push({
        id: row.id,
        kind: 'repository',
        programKey: 'github',
        programName: 'GitHub',
        title: row.github_login,
        subtitle: row.display_name ?? null,
        brand: githubBrand,
        attachedModules: [],
        eligibleModule: null,
        source: 'github',
        connectionId: row.id,
      })
    }

    return rows
  }, [
    appConnections,
    calendarRows,
    connections,
    emailGmail,
    emailOutlook,
    gmailBrand,
    github,
    githubBrand,
    mcpRows,
    outlookBrand,
    t,
  ])

  const visibleItems = useMemo(() => {
    const filtered = filterConnectionItems(items, query)
    return kindFilter === 'all' ? filtered : filtered.filter((row) => row.kind === kindFilter)
  }, [items, kindFilter, query])

  const groups = useMemo(() => groupConnectionItems(visibleItems), [visibleItems])
  const hasInstalledModule = modules.some((module) => moduleIsOn(module))

  const refreshAll = useCallback(async () => {
    await Promise.all([refresh(), refreshCatalog()])
  }, [refresh, refreshCatalog])

  const handleDisconnect = async (item: ConnectionListItem) => {
    if (item.source === 'inbox' || item.source === 'calendar') return
    if (!window.confirm(t('integrations.actions.disconnectConfirm'))) return
    try {
      if (item.source === 'mcp') await revokeMcpConnection(item.connectionId)
      else await revokeIntegrationConnection(item.connectionId)
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

  const openProgram = (programKey: string) => {
    const target = resolveApplicationConnectTarget(applications, programKey)
    if (target) {
      openApplicationHub(target.app, target.offer ? 'offer-setup' : 'app', target.offer ?? null)
    }
  }

  return (
    <PageContent width="xl" className="space-y-8">
      <PageGuideBanner page="integrations" />
      <IntegrationsTabs />
      <p className="max-w-2xl text-sm text-text-secondary">
        {t('integrations.pageMeta.connected.description')}
      </p>

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
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          {t('integrations.connected.yourList')}
        </h2>
        {loading ? (
          <CardGridSkeleton />
        ) : groups.length === 0 ? (
          <p className="text-sm text-text-muted">
            {query.trim()
              ? t('integrations.connected.noSearchMatches')
              : t('integrations.connected.emptyAllDescription')}
          </p>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group.kind} className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold text-text-heading">
                    {t(`integrations.kind.${group.kind}`)}
                  </h3>
                  {group.kind === 'repository' ? (
                    <p className="text-[11px] text-text-muted">{t('integrations.connected.codeHint')}</p>
                  ) : null}
                </div>
                <div className="space-y-4">
                  {group.programs.map((program) => (
                    <div key={program.programKey} className="rounded-xl border border-border/60 bg-bg-surface">
                      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <IntegrationHostLogo
                            logoUrl={program.brand.logoUrl}
                            logoDarkUrl={program.brand.logoDarkUrl}
                            initials={program.brand.initials}
                            color={program.brand.color}
                            name={program.programName}
                            hostSlug={program.brand.hostSlug}
                            size="sm"
                          />
                          <p className="text-sm font-medium truncate">{program.programName}</p>
                          <span className="text-[11px] tabular-nums text-text-muted">
                            {t('integrations.application.alreadyCount', { count: program.items.length })}
                          </span>
                        </div>
                        {program.kind !== 'inbox' && program.kind !== 'calendar' ? (
                          <Button size="sm" variant="ghost" onClick={() => openProgram(program.programKey)}>
                            {t('integrations.actions.connectAnother')}
                          </Button>
                        ) : null}
                      </div>
                      <ul>
                        {program.items.map((row) => {
                          const canAttach =
                            Boolean(row.eligibleModule) &&
                            !row.attachedModules.includes(row.eligibleModule ?? '')
                          return (
                            <li
                              key={row.id}
                              className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 border-t border-border/30 first:border-t-0"
                            >
                              <div className="min-w-0">
                                <p className="text-sm text-text-heading truncate">{row.title}</p>
                                <p className="text-[11px] text-text-muted truncate">
                                  {row.attachedModules.length > 0
                                    ? row.attachedModules
                                        .map((slug) =>
                                          t(`integrations.modules.${slug}.name`, { defaultValue: slug }),
                                        )
                                        .join(', ')
                                    : row.subtitle}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {row.source === 'inbox' ? (
                                  <Button size="sm" variant="outline" asChild>
                                    <Link to="/settings/channels">{t('integrations.connected.openChannels')}</Link>
                                  </Button>
                                ) : null}
                                {row.source === 'calendar' ? (
                                  <Button size="sm" variant="outline" asChild>
                                    <Link to="/agenda">{t('integrations.actions.manage')}</Link>
                                  </Button>
                                ) : null}
                                {canAttach && row.eligibleModule ? (
                                  <Button size="sm" variant="secondary" onClick={() => void handleAttach(row)}>
                                    {t('integrations.connected.useInModule', {
                                      name: t(`integrations.modules.${row.eligibleModule}.name`, {
                                        defaultValue: row.eligibleModule,
                                      }),
                                    })}
                                  </Button>
                                ) : null}
                                {row.source !== 'inbox' && row.source !== 'calendar' ? (
                                  <Button size="sm" variant="ghost" onClick={() => void handleDisconnect(row)}>
                                    {t('integrations.actions.disconnect')}
                                  </Button>
                                ) : null}
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section id="catalog" className="space-y-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            {t('integrations.connected.catalogTitle')}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            {t('integrations.connected.catalogHint')}
          </p>
        </div>
        <ConnectionsCatalogList
          applications={applications}
          kindFilter={kindFilter}
          query={query}
          onOpen={(app) => openApplicationHub(app)}
        />
      </section>

      <ApplicationHubDialog
        open={hubOpen}
        onOpenChange={setHubOpen}
        application={hubApplication}
        initialStep={hubStep}
        initialOfferId={hubOffer?.integration.id ?? null}
        banner={hubBanner}
        onViewConnected={() => setHubOpen(false)}
        onSaved={() => void refreshAll()}
      />
    </PageContent>
  )
}
