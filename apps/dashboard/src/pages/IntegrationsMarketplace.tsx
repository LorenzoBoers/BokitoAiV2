import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { parseIntegrationCallback } from '../lib/integrations-oauth'
import { parseOAuthCallback, describeOAuthCallbackSummary } from '../lib/email-oauth'
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
import { SLUG_TO_STATIC_ID } from '../lib/integrations/registry'
import { useIntegrationCatalog } from '../hooks/useIntegrationCatalog'
import { ModulePowerSwitch } from '../components/integrations/ModulePowerSwitch'
import { ModuleStatusBadge } from '../components/integrations/ModuleStatusBadge'
import { moduleHomePath, moduleIsOn, plannedProviderLabel } from '../lib/integration-modules'
import {
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
  const { applications, modules, loadError, refreshCatalog, setModuleEnabled } =
    useIntegrationCatalog()

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
      if (next === 'available') params.delete('status')
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

  const moduleSlugs = useMemo(() => new Set(modules.map((m) => m.slug)), [modules])

  const moduleSections = useMemo(() => {
    const q = search.trim().toLowerCase()
    return modules
      .map((module) => {
        const apps = filtered.filter((app) => app.module === module.slug && app.status !== 'coming_soon')
        const name = t(`integrations.modules.${module.slug}.name`, { defaultValue: module.name })
        const description = t(`integrations.modules.${module.slug}.description`, {
          defaultValue: module.description,
        })
        const searchMatch =
          !q || name.toLowerCase().includes(q) || description.toLowerCase().includes(q)
        const showEmptyModule =
          apps.length === 0 &&
          statusFilter !== 'connected' &&
          searchMatch &&
          (module.status === 'coming_soon' || module.status === 'available')
        return { module, name, description, apps, showEmptyModule }
      })
      .filter((s) => s.apps.length > 0 || s.showEmptyModule)
  }, [modules, filtered, search, statusFilter, t])

  const ungrouped = useMemo(
    () => filtered.filter((app) => !app.module || !moduleSlugs.has(app.module)),
    [filtered, moduleSlugs],
  )

  return (
    <PageContent width="xl">
      <IntegrationsTabs />
      <div className="mb-6">
        <p className="max-w-2xl text-sm text-text-secondary">
          {t('integrations.pageMeta.marketplace.description')}
        </p>
        <p className="mt-1 max-w-2xl text-xs text-text-muted">
          {t('integrations.pageMeta.marketplace.modulesHint', {
            defaultValue:
              'Business modules are turned on under Settings > Modules. Packages below show which connectors belong to each module.',
          })}
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

      {filtered.length === 0 && moduleSections.length === 0 ? (
        <EmptyState
          icon={Search}
          title={
            kindFilter === 'all'
              ? t('integrations.marketplace.empty')
              : t('integrations.marketplace.emptyKind')
          }
        />
      ) : (
        <div className="space-y-8">
          {moduleSections.map((section) => (
            <section key={section.module.slug}>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Link
                  to={moduleHomePath(section.module)}
                  className="text-sm font-semibold text-text-primary hover:text-accent"
                >
                  {section.name}
                </Link>
                <ModuleStatusBadge module={section.module} />
                {section.module.status === 'coming_soon' ? null : (
                  <ModulePowerSwitch module={section.module} onToggle={setModuleEnabled} />
                )}
                {section.module.status === 'coming_soon' ? null : (
                  <Link
                    to={moduleHomePath(section.module)}
                    className="text-xs font-medium text-accent hover:underline"
                  >
                    {moduleIsOn(section.module) &&
                    !(section.module.tenant_status === 'connected' || section.module.connected)
                      ? t('integrations.modules.connectCta', {
                          defaultValue: 'Connect a package',
                        })
                      : t('integrations.modules.manageCta', {
                          defaultValue: 'Manage {{name}}',
                          name: section.name,
                        })}
                  </Link>
                )}
              </div>
              <p className="mb-3 max-w-2xl text-xs text-text-muted">{section.description}</p>
              {section.apps.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {section.apps.map((application) => (
                    <ApplicationCard
                      key={application.hostSlug}
                      application={application}
                      onOpenDetail={() => openApplicationHub(application, 'app')}
                    />
                  ))}
                </div>
              ) : null}
              {section.module.planned_provider_slugs.length > 0 ? (
                <div className={`${section.apps.length > 0 ? 'mt-3' : ''} rounded-lg border border-dashed border-border-default p-4`}>
                  <p className="text-xs text-text-muted">
                    {t('integrations.modules.planned', {
                      defaultValue: 'Planned connectors: {{providers}}',
                      providers: section.module.planned_provider_slugs
                        .map(plannedProviderLabel)
                        .join(', '),
                    })}
                  </p>
                </div>
              ) : section.apps.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border-default p-4">
                  <p className="text-xs text-text-muted">
                    {t('integrations.modules.plannedEmpty', {
                      defaultValue: 'Connectors for this module are not listed yet.',
                    })}
                  </p>
                </div>
              ) : null}
            </section>
          ))}
          {ungrouped.length > 0 ? (
            <section>
              {moduleSections.length > 0 ? (
                <h2 className="mb-3 text-sm font-semibold text-text-primary">
                  {t('integrations.modules.sectionOther', { defaultValue: 'More integrations' })}
                </h2>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {ungrouped.map((application) => (
                  <ApplicationCard
                    key={application.hostSlug}
                    application={application}
                    onOpenDetail={() => openApplicationHub(application, 'app')}
                  />
                ))}
              </div>
            </section>
          ) : null}
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
