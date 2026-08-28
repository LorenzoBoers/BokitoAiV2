import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { useIntegrationCatalog } from '../hooks/useIntegrationCatalog'
import { ApplicationCard } from '../components/integrations/ApplicationCard'
import {
  ApplicationHubDialog,
  type ApplicationHubStep,
} from '../components/integrations/ApplicationHubDialog'
import type { HubBanner } from '../components/integrations/IntegrationHubDialog'
import { PageContent } from '../components/layout/PageContent'
import { Button } from '../components/ui/button'
import { EmptyState } from '../components/ui/empty-state'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { ModulePowerSwitch } from '../components/integrations/ModulePowerSwitch'
import { ModuleStatusBadge } from '../components/integrations/ModuleStatusBadge'
import { moduleIsOn, plannedProviderLabel, verbLabelKey } from '../lib/integration-modules'
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

function hubStepFromLegacy(step: IntegrationHubStep, offer?: IntegrationOffer): ApplicationHubStep {
  if (!offer) return 'app'
  return step === 'setup' ? 'offer-setup' : 'offer-detail'
}

export default function ModuleSetupPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const { t } = useTranslation(['nav', 'common'])
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { applications, modules, loadError, refreshCatalog, setModuleEnabled } =
    useIntegrationCatalog()

  const [hubOpen, setHubOpen] = useState(false)
  const [hubApplication, setHubApplication] = useState<IntegrationApplication | null>(null)
  const [hubOffer, setHubOffer] = useState<IntegrationOffer | null>(null)
  const [hubStep, setHubStep] = useState<ApplicationHubStep>('app')
  const [hubBanner, setHubBanner] = useState<HubBanner>(null)

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
  const apps = useMemo(
    () =>
      applications.filter((app) => app.module === slug && app.status !== 'coming_soon'),
    [applications, slug],
  )
  const comingSoonApps = useMemo(
    () => applications.filter((app) => app.module === slug && app.status === 'coming_soon'),
    [applications, slug],
  )
  const verbLabels = module?.verb_labels ?? []
  const setupSteps = (module?.setup_steps ?? []).map((step, index) =>
    t(`integrations.modules.${module?.slug}.setup.${index}`, { defaultValue: step }),
  )
  const capability = module
    ? t(`integrations.modules.${module.slug}.capability`, {
        defaultValue: module.capability_summary || '',
      })
    : ''
  const planned = module?.planned_provider_slugs ?? []
  const canConnect = module?.status === 'available'
  const comingSoon = module?.status === 'coming_soon'
  const on = module ? moduleIsOn(module) : false
  const visibleSteps = on
    ? setupSteps.filter((step) => !/^(turn |zet )/i.test(step))
    : setupSteps

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
        const providerSlug = integrationCb.provider ?? 'github'
        const staticId = SLUG_TO_STATIC_ID[providerSlug] ?? providerSlug
        if (integrationCb.error) {
          setHubBanner({ type: 'error', message: integrationCb.error })
        } else if (integrationCb.connected) {
          setHubBanner({
            type: 'success',
            message: t('integrations.hub.setup.successRemoteMcp'),
          })
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

  return (
    <PageContent width="lg">
      <div className="mb-6">
        <Link
          to="/settings/modules"
          className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-primary"
        >
          <ArrowLeft size={12} />
          {t('integrations.modules.backToModules', { defaultValue: 'Back to Modules' })}
        </Link>
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
            <ModulePowerSwitch module={module} onToggle={setModuleEnabled} />
          ) : null}
        </div>
        {module && !comingSoon && on && !(module.tenant_status === 'connected' || module.connected) ? (
          <p className="mt-3 rounded-lg border border-accent/30 bg-accent/8 px-3 py-2 text-sm text-text-primary">
            {t('integrations.modules.nextConnect', {
              defaultValue: '{{name}} is on. Connect a package so agents can use it.',
              name,
            })}
          </p>
        ) : module && !comingSoon ? (
          <p className="mt-2 text-xs text-text-muted">
            {on
              ? t('integrations.modules.toggleHint', {
                  defaultValue:
                    'Turning a module off hides it from agents. Connected packages stay in place.',
                })
              : t('integrations.modules.enableToUseHint', {
                  defaultValue:
                    'Turn this module on so agents can use it. Connecting a package also turns it on.',
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
            title={t('integrations.modules.notFound', { defaultValue: 'This module is not in the catalog.' })}
          />
        )
      ) : (
        <div className="space-y-8">
          {(() => {
            const verbs = verbLabels.length > 0 ? (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-text-primary">
                  {t('integrations.modules.verbsTitle', { defaultValue: 'What agents can do' })}
                </h3>
                <ul className="flex flex-wrap gap-1.5">
                  {verbLabels.map((label) => (
                    <li
                      key={label}
                      className="rounded-full border border-border/60 px-2.5 py-0.5 text-xs text-text-secondary"
                    >
                      {t(`integrations.modules.verbs.${verbLabelKey(label)}`, { defaultValue: label })}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-text-muted">
                  {t('integrations.modules.writesNote', {
                    defaultValue: 'Writes always become a decision you approve.',
                  })}
                </p>
              </section>
            ) : null
            const packages = (
              <section>
                <h3 className="mb-3 text-sm font-semibold text-text-primary">
                  {t('integrations.modules.connectors', { defaultValue: 'Packages' })}
                </h3>
                {apps.length > 0 ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {apps.map((application) => (
                      <ApplicationCard
                        key={application.hostSlug}
                        application={application}
                        onOpenDetail={() => {
                          if (!canConnect) return
                          const offer = application.offers[0] ?? null
                          openApplicationHub(application, on && offer ? 'offer-setup' : 'app', offer)
                        }}
                      />
                    ))}
                  </div>
                ) : null}
                {planned.length > 0 || comingSoonApps.length > 0 ? (
                  <div className={`${apps.length > 0 ? 'mt-3' : ''} rounded-lg border border-dashed border-border-default p-4`}>
                    <p className="text-xs text-text-muted">
                      {t('integrations.modules.planned', {
                        defaultValue: 'Planned connectors: {{providers}}',
                        providers: [
                          ...new Set([
                            ...planned.map(plannedProviderLabel),
                            ...comingSoonApps.map((app) => app.name),
                          ]),
                        ].join(', '),
                      })}
                    </p>
                  </div>
                ) : null}
              </section>
            )
            return (
              <>
                {capability ? (
                  <p className="max-w-2xl text-sm text-text-secondary">{capability}</p>
                ) : null}
                {on ? packages : verbs}
                {on ? verbs : packages}
                {visibleSteps.length > 0 ? (
                  <section>
                    <h3 className="mb-2 text-sm font-semibold text-text-primary">
                      {t('integrations.modules.setupSteps', { defaultValue: 'Setup' })}
                    </h3>
                    <ol className="list-decimal space-y-1.5 pl-5 text-sm text-text-secondary">
                      {visibleSteps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </section>
                ) : null}
              </>
            )
          })()}
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
