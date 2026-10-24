import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LayoutGrid, List, Search } from 'lucide-react'
import { toast } from 'sonner'
import { PageContent } from '../components/layout/PageContent'
import { PageHeader } from '../components/ui/page-header'
import { PageRelatedLinks } from '../components/layout/PageRelatedLinks'
import { Button } from '../components/ui/button'
import { SearchField } from '../components/ui/search-field'
import { SegmentedControl } from '../components/ui/segmented-control'
import { EmptyState } from '../components/ui/empty-state'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { IconTile } from '../components/ui/icon-tile'
import { ConnectionsHubTabs } from '../components/integrations/ConnectionsHubTabs'
import { IntegrationKindNav } from '../components/integrations/IntegrationKindNav'
import { ConnectedTile } from '../components/integrations/ConnectedTile'
import {
  InstalledConnectionCards,
  InstalledConnectionList,
} from '../components/integrations/InstalledConnectionViews'
import {
  ApplicationHubPanel,
  type ApplicationHubStep,
  type HubBanner,
} from '../components/integrations/ApplicationHubPanel'
import { useConnectedIntegrationsSummary } from '../hooks/useConnectedIntegrationsSummary'
import { useMailboxConnections } from '../hooks/useMailboxConnections'
import { useIntegrationCatalog } from '../hooks/useIntegrationCatalog'
import {
  CONNECTIONS_DISCOVER_PATH,
  connectionsInstalledPath,
  parseConnectionsView,
  parseKindFilter,
  type IntegrationKindFilter,
} from '../lib/integration-kind-url'
import {
  buildInstalledConnectionRows,
  filterInstalledConnections,
  type InstalledConnectionRow,
} from '../lib/installed-connections'
import {
  resolveApplicationConnectTarget,
  type IntegrationApplication,
  type IntegrationOffer,
} from '../lib/integration-applications'
import { moduleHomePath, moduleIsOn, moduleNavIcon } from '../lib/integration-modules'
import { GRID_PATH } from '../lib/navigation'
import type { IntegrationKind } from '../lib/integration-kind'

/**
 * Installed: every registration as a card or list row so operators can manage
 * multiple logins to one host (e.g. several King administrations) one by one.
 */
export default function InstalledConnections() {
  const { t } = useTranslation(['nav', 'common'])
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const kindFilter = parseKindFilter(searchParams.get('kind'))
  const view = parseConnectionsView(searchParams.get('view'))
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')

  const { loading, loadError, mcpRows, connections, calendarRows, github, refresh } =
    useConnectedIntegrationsSummary()
  const { connections: mailboxes, refresh: refreshMailboxes } = useMailboxConnections()
  const { applications, modules, loadError: catalogError, refreshCatalog } = useIntegrationCatalog()

  const [hubOpen, setHubOpen] = useState(false)
  const [hubApplication, setHubApplication] = useState<IntegrationApplication | null>(null)
  const [hubOffer, setHubOffer] = useState<IntegrationOffer | null>(null)
  const [hubStep, setHubStep] = useState<ApplicationHubStep>('app')
  const [hubBanner, setHubBanner] = useState<HubBanner>(null)

  const writeParams = useCallback(
    (patch: { kind?: IntegrationKindFilter; q?: string; view?: 'cards' | 'list' }) => {
      const nextKind = patch.kind ?? kindFilter
      const nextQ = patch.q !== undefined ? patch.q : query
      const nextView = patch.view ?? view
      const path = connectionsInstalledPath({
        kind: nextKind,
        q: nextQ,
        view: nextView,
      })
      const [, qs] = path.split('?')
      setSearchParams(new URLSearchParams(qs ?? ''), { replace: true })
      if (patch.q !== undefined) setQuery(patch.q)
    },
    [kindFilter, query, setSearchParams, view],
  )

  const installedModules = useMemo(
    () => modules.filter((module) => module.status !== 'coming_soon' && moduleIsOn(module)),
    [modules],
  )

  const allRows = useMemo(
    () =>
      buildInstalledConnectionRows({
        connections,
        mcpRows,
        calendarRows,
        github,
        mailboxes,
      }),
    [calendarRows, connections, github, mailboxes, mcpRows],
  )

  const kindForFilter: IntegrationKind | 'all' =
    kindFilter === 'all' || kindFilter === 'modules' || kindFilter === 'ai_tools'
      ? 'all'
      : kindFilter

  const visibleRows = useMemo(() => {
    if (kindFilter === 'modules' || kindFilter === 'ai_tools') return []
    return filterInstalledConnections(allRows, { kind: kindForFilter, query })
  }, [allRows, kindFilter, kindForFilter, query])

  const showModulesOnly = kindFilter === 'modules'
  const showEmptyFilter = kindFilter === 'ai_tools'

  const counts = useMemo(() => {
    const byKind: Partial<Record<IntegrationKindFilter, number>> = {
      modules: installedModules.length,
    }
    for (const row of allRows) {
      byKind[row.kind] = (byKind[row.kind] ?? 0) + 1
    }
    return byKind
  }, [allRows, installedModules.length])

  const refreshAll = useCallback(async () => {
    await Promise.all([refresh(), refreshCatalog(), refreshMailboxes()])
  }, [refresh, refreshCatalog, refreshMailboxes])

  const openApplicationHub = useCallback(
    (app: IntegrationApplication, step: ApplicationHubStep = 'app', offer: IntegrationOffer | null = null) => {
      setHubApplication(app)
      setHubOffer(offer)
      setHubStep(step)
      setHubOpen(true)
    },
    [],
  )

  const handleManage = useCallback(
    (row: InstalledConnectionRow) => {
      if (row.manageHref) {
        navigate(row.manageHref)
        return
      }
      if (row.eligibleModule) {
        const mod = modules.find((m) => m.slug === row.eligibleModule)
        if (mod && row.attachedModules.includes(row.eligibleModule)) {
          navigate(moduleHomePath(mod))
          return
        }
      }
      const target = resolveApplicationConnectTarget(applications, row.programKey)
      if (target) {
        openApplicationHub(target.app, target.offer ? 'offer-detail' : 'app', target.offer ?? null)
        return
      }
      toast.message(t('integrations.installed.openDiscoverHint'))
      navigate(`${CONNECTIONS_DISCOVER_PATH}?connect=${encodeURIComponent(row.programKey)}`)
    },
    [applications, modules, navigate, openApplicationHub, t],
  )

  const catalogLoading = loading && allRows.length === 0 && installedModules.length === 0
  const hasActiveFilter = Boolean(query.trim()) || kindFilter !== 'all'

  return (
    <PageContent width="xl" className="space-y-8">
      <PageHeader
        guide="integrations"
        title={t('tabs.modules.title', { defaultValue: 'Connections' })}
        subtitle={t('integrations.pageMeta.installed.description', {
          defaultValue: 'Every login and administration in this workspace. Switch to list view to manage many at once.',
        })}
        className="mb-0"
        actions={
          <Button asChild size="sm" variant="secondary">
            <Link to={CONNECTIONS_DISCOVER_PATH}>
              {t('integrations.installed.addConnection', { defaultValue: 'Add connection' })}
            </Link>
          </Button>
        }
      />

      <ConnectionsHubTabs active="installed" installedCount={allRows.length} />

      {loadError || catalogError ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-text-muted">{loadError ? t(loadError) : catalogError}</p>
          <Button type="button" size="sm" variant="ghost" onClick={() => void refreshAll()}>
            {t('actions.retry', { ns: 'common' })}
          </Button>
        </div>
      ) : null}

      {installedModules.length > 0 && kindFilter === 'all' && !query.trim() ? (
        <section className="space-y-3" aria-labelledby="installed-modules">
          <h2 id="installed-modules" className="text-xs font-semibold text-text-muted">
            {t('integrations.filters.modules')}
          </h2>
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]">
            {installedModules.map((module) => {
              const Icon = moduleNavIcon(module.slug)
              const specialist = module.specialist_agent_name
              return (
                <ConnectedTile
                  key={module.slug}
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
          </div>
        </section>
      ) : null}

      <section className="space-y-4" aria-labelledby="installed-connections">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h2 id="installed-connections" className="text-xs font-semibold text-text-muted">
              {t('integrations.installed.listTitle', {
                count: showModulesOnly ? installedModules.length : visibleRows.length,
                defaultValue: '{{count}} connections',
              })}
            </h2>
            <IntegrationKindNav
              value={kindFilter}
              onChange={(next) => writeParams({ kind: next })}
              counts={counts}
              className="mt-2"
            />
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end lg:w-auto">
            <SearchField
              value={query}
              onChange={(next) => writeParams({ q: next })}
              placeholder={t('integrations.installed.searchPlaceholder')}
              aria-label={t('integrations.installed.searchPlaceholder')}
              className="w-full sm:w-72"
            />
            <SegmentedControl<'cards' | 'list'>
              size="sm"
              value={view}
              onChange={(next) => writeParams({ view: next })}
              aria-label={t('integrations.installed.view')}
              options={[
                {
                  value: 'cards',
                  label: t('integrations.installed.viewCards'),
                  icon: <LayoutGrid size={14} aria-hidden />,
                },
                {
                  value: 'list',
                  label: t('integrations.installed.viewList'),
                  icon: <List size={14} aria-hidden />,
                },
              ]}
            />
          </div>
        </div>

        {catalogLoading ? (
          <CardGridSkeleton />
        ) : showModulesOnly ? (
          installedModules.length === 0 ? (
            <EmptyState
              icon={Search}
              title={t('integrations.installed.emptyModules')}
              action={
                <Button asChild size="sm">
                  <Link to={`${CONNECTIONS_DISCOVER_PATH}?kind=modules`}>
                    {t('integrations.installed.browseModules')}
                  </Link>
                </Button>
              }
            />
          ) : (
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]">
              {installedModules
                .filter((m) => {
                  const q = query.trim().toLowerCase()
                  if (!q) return true
                  const name = t(`integrations.modules.${m.slug}.name`, { defaultValue: m.name })
                  return name.toLowerCase().includes(q) || m.slug.includes(q)
                })
                .map((module) => {
                  const Icon = moduleNavIcon(module.slug)
                  return (
                    <ConnectedTile
                      key={module.slug}
                      mark={<IconTile icon={Icon} />}
                      name={t(`integrations.modules.${module.slug}.name`, { defaultValue: module.name })}
                      meta={t('integrations.filters.modules')}
                      onClick={() => navigate(moduleHomePath(module))}
                    />
                  )
                })}
            </div>
          )
        ) : showEmptyFilter || visibleRows.length === 0 ? (
          <EmptyState
            icon={Search}
            title={
              hasActiveFilter
                ? t('integrations.marketplace.emptyFiltered')
                : t('integrations.installed.empty')
            }
            action={
              hasActiveFilter ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    writeParams({ kind: 'all', q: '' })
                  }}
                >
                  {t('integrations.marketplace.clearFilters')}
                </Button>
              ) : (
                <Button asChild size="sm">
                  <Link to={CONNECTIONS_DISCOVER_PATH}>
                    {t('integrations.installed.browseDiscover')}
                  </Link>
                </Button>
              )
            }
          />
        ) : view === 'list' ? (
          <InstalledConnectionList rows={visibleRows} onManage={handleManage} />
        ) : (
          <InstalledConnectionCards rows={visibleRows} onManage={handleManage} />
        )}
      </section>

      <ApplicationHubPanel
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
          }
        }}
        application={hubApplication}
        initialStep={hubStep}
        initialOfferId={hubOffer?.integration.id ?? null}
        banner={hubBanner}
        modules={modules}
        onViewConnected={() => undefined}
        onSaved={() => void refreshAll()}
      />

      <PageRelatedLinks links={[{ to: GRID_PATH, label: t('orgCanvas.link') }]} />
    </PageContent>
  )
}
