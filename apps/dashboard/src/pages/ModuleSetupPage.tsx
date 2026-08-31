import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { useIntegrationCatalog } from '../hooks/useIntegrationCatalog'
import {
  ApplicationHubDialog,
  type ApplicationHubStep,
} from '../components/integrations/ApplicationHubDialog'
import type { HubBanner } from '../components/integrations/IntegrationHubDialog'
import { ModuleConnectionsPanel } from '../components/integrations/ModuleConnectionsPanel'
import { ModuleSourcesPanel } from '../components/integrations/ModuleSourcesPanel'
import { ModuleOverview } from '../components/modules/ModuleOverview'
import {
  buildModulePackageItems,
  type ModulePackageItem,
} from '../components/integrations/ModulePackageGrid'
import { ModuleProviderPickerDialog } from '../components/integrations/ModuleProviderPickerDialog'
import { ModuleToolsetDropdown } from '../components/integrations/ModuleToolsetDropdown'
import { ModuleToolsetPanel } from '../components/integrations/ModuleToolsetPanel'
import { PageContent } from '../components/layout/PageContent'
import { Button } from '../components/ui/button'
import { EmptyState } from '../components/ui/empty-state'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { ModuleInstallControls } from '../components/integrations/ModuleInstallControls'
import { ModuleStatusBadge } from '../components/integrations/ModuleStatusBadge'
import { ModuleAgentsSection } from '../components/modules/ModuleAgentsSection'
import { listAgents } from '../lib/agents-api'
import type { RuntimeAgent } from '../lib/workforce-api'
import { moduleIsInSetup, moduleIsOn } from '../lib/integration-modules'
import {
  parseHubConnectParam,
  stripOAuthCallbackParams,
  type IntegrationHubStep,
} from '../lib/integration-setup-url'
import { connectedPathWithKind } from '../lib/integration-kind-url'
import { resolveIntegrationKind } from '../lib/integration-kind'
import { parseIntegrationCallback } from '../lib/integrations-oauth'
import { describeOAuthCallbackSummary, parseOAuthCallback } from '../lib/email-oauth'
import { SLUG_TO_STATIC_ID } from '../lib/integrations/registry'
import {
  resolveApplicationConnectTarget,
  type IntegrationApplication,
  type IntegrationOffer,
} from '../lib/integration-applications'
import { talkToAssistantPath } from '../lib/talk-to-assistant'

type ModuleTab = 'overview' | 'connections' | 'sources' | 'setup'

function hubStepFromLegacy(step: IntegrationHubStep, offer?: IntegrationOffer): ApplicationHubStep {
  if (!offer) return 'app'
  return step === 'setup' ? 'offer-setup' : 'offer-detail'
}

function parseTab(raw: string | null): ModuleTab {
  if (raw === 'connections' || raw === 'sources' || raw === 'setup') return raw
  return 'overview'
}

export default function ModuleSetupPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const { t } = useTranslation(['nav', 'common'])
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = parseTab(searchParams.get('tab'))
  const { applications, modules, loadError, refreshCatalog, runModuleAction } =
    useIntegrationCatalog()

  const [hubOpen, setHubOpen] = useState(false)
  const [hubApplication, setHubApplication] = useState<IntegrationApplication | null>(null)
  const [hubOffer, setHubOffer] = useState<IntegrationOffer | null>(null)
  const [hubStep, setHubStep] = useState<ApplicationHubStep>('app')
  const [hubBanner, setHubBanner] = useState<HubBanner>(null)
  const [companyAgents, setCompanyAgents] = useState<RuntimeAgent[]>([])
  const [providerPickerOpen, setProviderPickerOpen] = useState(false)
  const [connectionsRefreshToken, setConnectionsRefreshToken] = useState(0)

  const bumpConnections = useCallback(() => {
    setConnectionsRefreshToken((n) => n + 1)
  }, [])

  useEffect(() => {
    void listAgents()
      .then((rows) => setCompanyAgents(rows.filter((a) => a.kind !== 'personal')))
      .catch(() => setCompanyAgents([]))
  }, [])

  const module = useMemo(
    () => modules.find((row) => row.slug === slug) ?? null,
    [modules, slug],
  )
  const name = module
    ? t(`integrations.modules.${module.slug}.name`, { defaultValue: module.name })
    : slug
  const description = module
    ? t(`integrations.modules.${module.slug}.description`, { defaultValue: module.description })
    : ''
  const moduleApps = useMemo(
    () => applications.filter((app) => app.module === slug),
    [applications, slug],
  )
  const packageItems = useMemo(
    () => buildModulePackageItems(moduleApps, module?.planned_provider_slugs ?? []),
    [moduleApps, module?.planned_provider_slugs],
  )
  const setupSteps = (module?.setup_steps ?? []).map((step, index) =>
    t(`integrations.modules.${module?.slug}.setup.${index}`, { defaultValue: step }),
  )
  const capability = module
    ? t(`integrations.modules.${module.slug}.capability`, {
        defaultValue: module.capability_summary || '',
      })
    : ''
  const canConnect = module?.status === 'available'
  const comingSoon = module?.status === 'coming_soon'
  const on = module ? moduleIsOn(module) : false
  const inSetup = module ? moduleIsInSetup(module) : false
  const visibleSteps = on || inSetup
    ? setupSteps.filter((step) => !/^(turn |zet |install )/i.test(step))
    : setupSteps

  const setTab = useCallback(
    (next: ModuleTab) => {
      const params = new URLSearchParams(searchParams)
      if (next === 'overview') params.delete('tab')
      else params.set('tab', next)
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

  const openPackageItem = useCallback(
    (item: ModulePackageItem) => {
      if (!canConnect || item.status === 'coming_soon') return
      const app = item.application
      if (!app) return
      const offer = app.offers[0] ?? null
      openApplicationHub(app, on && offer ? 'offer-setup' : 'app', offer)
    },
    [canConnect, on, openApplicationHub],
  )

  const applyCallbackBanner = useCallback(
    (params: URLSearchParams, connectParam: string | null) => {
      const integrationCb = parseIntegrationCallback(params)
      const emailCb = parseOAuthCallback(params)

      if (integrationCb.handled) {
        const providerSlug = integrationCb.provider ?? 'github'
        const staticId = SLUG_TO_STATIC_ID[providerSlug] ?? providerSlug
        if (integrationCb.error) {
          const errorMessage =
            integrationCb.error === 'oauth_not_configured'
              ? t('integrations.hub.setup.oauthNotConfigured', {
                  defaultValue:
                    'OAuth for this package is not configured on the server. Set the provider client credentials, then try again.',
                })
              : integrationCb.error
          setHubBanner({ type: 'error', message: errorMessage })
        } else if (integrationCb.connected) {
          setHubBanner({
            type: 'success',
            message: t('integrations.hub.setup.successRemoteMcp'),
          })
          bumpConnections()
        }
        const target = resolveApplicationConnectTarget(applications, connectParam ?? staticId)
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
          setHubBanner({ type: 'error', message: describeOAuthCallbackSummary(emailCb) })
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
    [applications, bumpConnections, openApplicationHub, t],
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
          const preferSetup = step === 'setup' || (module ? moduleIsOn(module) : false)
          openApplicationHub(
            target.app,
            preferSetup && target.offer
              ? 'offer-setup'
              : hubStepFromLegacy(step, target.offer),
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
  }, [applications, applyCallbackBanner, module, openApplicationHub, setSearchParams])

  const handleViewConnected = (offer: IntegrationOffer) => {
    const kind = offer.kind ?? resolveIntegrationKind(offer.integration.id)
    navigate(connectedPathWithKind(kind))
  }

  const openAddRegistration = () => {
    if (!canConnect) return
    setProviderPickerOpen(true)
  }

  const packageHostSlugs = useMemo(() => {
    const seen = new Set<string>()
    const slugs: string[] = []
    for (const item of packageItems) {
      if (seen.has(item.hostSlug)) continue
      seen.add(item.hostSlug)
      slugs.push(item.hostSlug)
    }
    return slugs
  }, [packageItems])

  const setupPrefill = t('integrations.modules.setup.assistantPrefill', {
    defaultValue:
      'Help me finish setting up the {{name}} module: turn it on if needed, connect a package, set the default registration, and make sure platform sources are indexed.',
    name,
  })
  const setupAgentId = module?.default_agent_id ?? null
  const setupChatPath = talkToAssistantPath(setupPrefill, setupAgentId)

  const tabs: { id: ModuleTab; label: string }[] = [
    {
      id: 'overview',
      label: t('integrations.modules.tabs.overview', { defaultValue: 'Overview' }),
    },
    {
      id: 'connections',
      label: t('integrations.modules.tabs.connections', { defaultValue: 'Connections' }),
    },
    {
      id: 'sources',
      label: t('integrations.modules.tabs.sources', { defaultValue: 'Sources' }),
    },
    {
      id: 'setup',
      label: t('integrations.modules.tabs.setup', { defaultValue: 'Setup' }),
    },
  ]

  return (
    <PageContent width="lg">
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/modules"
            className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-primary"
          >
            <ArrowLeft size={12} />
            {t('integrations.modules.backToModules', { defaultValue: 'Back to Modules' })}
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-text-heading">{name}</h2>
              {module ? <ModuleStatusBadge module={module} /> : null}
            </div>
            {description ? (
              <p className="mt-1 max-w-2xl text-sm text-text-secondary">{description}</p>
            ) : null}
          </div>
          {module && !comingSoon ? (
            <div className="flex flex-wrap items-center gap-2">
              <ModuleToolsetDropdown module={module} />
              <ModuleInstallControls module={module} onAction={runModuleAction} />
            </div>
          ) : null}
        </div>
        {module && !comingSoon && inSetup ? (
          <p className="mt-3 rounded-lg border border-accent/30 bg-accent/8 px-3 py-2 text-sm text-text-primary">
            {t('integrations.modules.setupInProgress', {
              defaultValue:
                'Finish setup to install {{name}}. Optionally link a platform integration it can use.',
              name,
            })}
          </p>
        ) : module &&
          !comingSoon &&
          on &&
          !(module.tenant_status === 'connected' || module.connected) ? (
          <p className="mt-3 rounded-lg border border-accent/30 bg-accent/8 px-3 py-2 text-sm text-text-primary">
            {t('integrations.modules.installedNoIntegration', {
              defaultValue:
                '{{name}} is installed. Link an optional integration so agents can reach live data.',
              name,
            })}
          </p>
        ) : module && !comingSoon ? (
          <p className="mt-2 text-xs text-text-muted">
            {on
              ? t('integrations.modules.installedHint', {
                  defaultValue:
                    'Installed modules appear under AI in the main menu. Uninstall removes them from agents.',
                })
              : t('integrations.modules.installHint', {
                  defaultValue:
                    'Install this module, complete setup, then open it from AI > Modules.',
                })}
          </p>
        ) : null}
        {loadError ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="text-xs text-text-muted">{loadError}</p>
            <Button type="button" size="sm" variant="ghost" onClick={() => void refreshCatalog()}>
              {t('common:actions.retry')}
            </Button>
          </div>
        ) : null}
      </div>

      {!module ? (
        applications.length === 0 && !loadError ? (
          <CardGridSkeleton cards={2} />
        ) : (
          <EmptyState
            title={t('integrations.modules.notFound', {
              defaultValue: 'This module is not in the catalog.',
            })}
            action={
              <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs">
                <Link to="/modules" className="font-medium text-accent hover:underline">
                  {t('integrations.modules.openCatalog', { defaultValue: 'Open Modules' })}
                </Link>
                <Link to="/modules/marketplace" className="font-medium text-accent hover:underline">
                  {t('integrations.modules.openMarketplace', { defaultValue: 'Open Marketplace' })}
                </Link>
              </div>
            }
          />
        )
      ) : (
        <>
          <nav className="mb-6 flex flex-wrap gap-1 border-b border-border/50 pb-px">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`rounded-t-md px-3 py-2 text-sm ${
                  tab === item.id
                    ? 'border-b-2 border-accent font-medium text-text-heading'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {tab === 'overview' ? (
            <div className="space-y-8">
              {capability ? (
                <p className="max-w-2xl text-sm text-text-secondary">{capability}</p>
              ) : null}
              {on ? <ModuleOverview module={module} applications={applications} /> : null}
              <ModuleConnectionsPanel
                slug={slug}
                onAddPackage={openAddRegistration}
                packageHostSlugs={packageHostSlugs}
                refreshToken={connectionsRefreshToken}
              />
              {!on ? (
                <>
                  <section>
                    <h3 className="mb-2 text-sm font-semibold text-text-primary">
                      {t('integrations.modules.verbsTitle', {
                        defaultValue: 'What agents can do',
                      })}
                    </h3>
                    <ModuleToolsetPanel module={module} />
                  </section>
                  <section>
                    <h3 className="mb-2 text-sm font-semibold text-text-primary">
                      {t('integrations.modules.agents.sectionTitle', {
                        defaultValue: 'Assigned agents',
                      })}
                    </h3>
                    <ModuleAgentsSection
                      moduleSlug={slug}
                      agents={companyAgents}
                      onChanged={() => void refreshCatalog()}
                    />
                  </section>
                </>
              ) : null}
              {visibleSteps.length > 0 ? (
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-text-primary">
                    {t('integrations.modules.setupSteps', { defaultValue: 'Setup checklist' })}
                  </h3>
                  <ol className="list-decimal space-y-1.5 pl-5 text-sm text-text-secondary">
                    {visibleSteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </section>
              ) : null}
            </div>
          ) : null}

          {tab === 'connections' ? (
            <ModuleConnectionsPanel
              slug={slug}
              onAddPackage={openAddRegistration}
              packageHostSlugs={packageHostSlugs}
              refreshToken={connectionsRefreshToken}
            />
          ) : null}

          {tab === 'sources' ? <ModuleSourcesPanel slug={slug} /> : null}

          {tab === 'setup' ? (
            <section className="space-y-4">
              <p className="max-w-2xl text-sm text-text-secondary">
                {t('integrations.modules.setup.intro', {
                  defaultValue:
                    'Assign at least one AI agent, then chat with the default agent to connect packages, set defaults, and index sources.',
                })}
              </p>
              <ModuleAgentsSection
                moduleSlug={slug}
                agents={companyAgents}
                onChanged={() => void refreshCatalog()}
              />
              {visibleSteps.length > 0 ? (
                <ol className="list-decimal space-y-1.5 pl-5 text-sm text-text-secondary">
                  {visibleSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              ) : null}
              {setupAgentId ? (
                <Button asChild>
                  <Link to={setupChatPath}>
                    {t('integrations.modules.setup.openAssistant', {
                      defaultValue: 'Continue with assigned agent',
                    })}
                  </Link>
                </Button>
              ) : (
                <Button type="button" disabled>
                  {t('integrations.modules.setup.openAssistant', {
                    defaultValue: 'Continue with assigned agent',
                  })}
                </Button>
              )}
            </section>
          ) : null}
        </>
      )}

      <ModuleProviderPickerDialog
        open={providerPickerOpen}
        onOpenChange={setProviderPickerOpen}
        items={packageItems}
        onSelect={openPackageItem}
      />

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
        onSaved={() => {
          void refreshCatalog()
          bumpConnections()
        }}
      />
    </PageContent>
  )
}
