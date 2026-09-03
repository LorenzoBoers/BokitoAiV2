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
import { MarketplaceModuleCard } from '../components/integrations/ModuleCard'
import { applicationsForModule } from '../lib/module-applications'
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
  type HubBanner,
} from '../components/integrations/ApplicationHubDialog'
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

export default function ConnectionsMarketplace() {
  const { t } = useTranslation(['nav', 'common'])
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const kindFilter = parseKindFilter(searchParams.get('kind'))
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
  const statusFilter = parseStatusFilter(searchParams.get('status'))
  const { applications, modules, loadError, refreshCatalog, runModuleAction } =
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

  /**
   * Modules are their own zone: a preset is not a login, so the kind and status
   * filters (which describe connections) hide the strip instead of reshaping it.
   */
  const visibleModules = useMemo(() => {
    if (kindFilter !== 'all' || statusFilter === 'connected') return []
    const q = search.trim().toLowerCase()
    if (!q) return modules
    return modules.filter((module) => {
      const name = t(`integrations.modules.${module.slug}.name`, { defaultValue: module.name })
      const description = t(`integrations.modules.${module.slug}.description`, {
        defaultValue: module.description,
      })
      return `${name} ${description}`.toLowerCase().includes(q)
    })
  }, [modules, kindFilter, statusFilter, search, t])

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
              'Modules install a domain preset for agents. Integrations are the programs you sign in to; a module runs on top of them.',
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

      {filtered.length === 0 && visibleModules.length === 0 ? (
        <EmptyState
          icon={Search}
          title={
            search.trim() || kindFilter !== 'all' || statusFilter !== 'all'
              ? t('integrations.marketplace.emptyFiltered')
              : kindFilter === 'all'
                ? t('integrations.marketplace.empty')
                : t('integrations.marketplace.emptyKind')
          }
          action={
            <div className="flex flex-col items-center gap-2">
              {search.trim() || kindFilter !== 'all' || statusFilter !== 'all' ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setSearchQuery('')
                    setKindFilter('all')
                    setStatusFilter('all')
                  }}
                >
                  {t('integrations.marketplace.clearFilters')}
                </Button>
              ) : null}
              <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs">
                <Link to="/connections" className="font-medium text-accent hover:underline">
                  {t('integrations.marketplace.openConnected')}
                </Link>
              </div>
            </div>
          }
        />
      ) : (
        <div className="space-y-10">
          {visibleModules.length > 0 ? (
            <section>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-text-primary">
                  {t('integrations.marketplace.modulesTitle', { defaultValue: 'Modules' })}
                </h2>
                <p className="text-xs text-text-muted">
                  {t('integrations.marketplace.modulesSubtitle', {
                    defaultValue: 'Domain presets: tools, prompts, and decisions in one install.',
                  })}
                </p>
              </div>
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {visibleModules.map((module) => (
                  <MarketplaceModuleCard
                    key={module.slug}
                    module={module}
                    applications={applicationsForModule(applications, module)}
                    onAction={runModuleAction}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {filtered.length > 0 ? (
            <section>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-text-primary">
                  {t('integrations.marketplace.integrationsTitle', {
                    defaultValue: 'Integrations',
                  })}
                </h2>
                <p className="text-xs text-text-muted">
                  {t('integrations.marketplace.integrationsSubtitle', {
                    defaultValue: 'Sign in to a program so agents can read and act in it.',
                  })}
                </p>
              </div>
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((application) => (
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
        modules={modules}
        onViewConnected={handleViewConnected}
        onSaved={() => void refreshCatalog()}
      />
    </PageContent>
  )
}
