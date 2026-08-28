import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useIntegrationCatalog } from '../hooks/useIntegrationCatalog'
import { ModulePowerSwitch } from '../components/integrations/ModulePowerSwitch'
import { ModuleStatusBadge } from '../components/integrations/ModuleStatusBadge'
import { IntegrationHostLogo } from '../components/integrations/IntegrationHostLogo'
import { PageContent } from '../components/layout/PageContent'
import { Button } from '../components/ui/button'
import { CardGridSkeleton } from '../components/ui/skeleton'
import {
  moduleHomePath,
  moduleIsOn,
  plannedProviderLabel,
  verbLabelKey,
} from '../lib/integration-modules'
import { moduleSetupPath } from '../lib/integration-setup-url'
import type { IntegrationApplication } from '../lib/integration-applications'
import type { IntegrationModuleRow } from '../lib/integrations-api'

function packageConnectId(app: IntegrationApplication): string {
  return app.offers[0]?.integration.id || app.hostSlug
}

function ConnectorShowcase({
  module,
  applications,
}: {
  module: IntegrationModuleRow
  applications: IntegrationApplication[]
}) {
  const { t } = useTranslation('nav')
  const apps = applications.filter(
    (app) => app.module === module.slug && app.status !== 'coming_soon',
  )
  const planned = module.planned_provider_slugs ?? []
  if (apps.length === 0 && planned.length === 0) return null

  return (
    <div className="mt-4">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">
        {t('integrations.modules.connectors', { defaultValue: 'Packages' })}
      </p>
      {apps.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-2">
          {apps.map((app) => (
            <li key={app.hostSlug}>
              <Link
                to={moduleSetupPath(module.slug, packageConnectId(app), 'setup')}
                aria-label={t('integrations.modules.connectPackage', {
                  defaultValue: 'Connect {{name}}',
                  name: app.name,
                })}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 hover:border-accent/50 hover:bg-bg-hover/50"
              >
                <IntegrationHostLogo
                  logoUrl={app.brand.logoUrl}
                  logoDarkUrl={app.brand.logoDarkUrl}
                  initials={app.brand.initials}
                  color={app.brand.color}
                  name=""
                  hostSlug={app.brand.hostSlug}
                  size="sm"
                  className="rounded-md"
                />
                <span className="text-xs text-text-secondary">{app.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {planned.length > 0 ? (
        <p className={`${apps.length > 0 ? 'mt-2' : ''} text-xs text-text-muted`}>
          {t('integrations.modules.planned', {
            defaultValue: 'Planned connectors: {{providers}}',
            providers: planned.map(plannedProviderLabel).join(', '),
          })}
        </p>
      ) : null}
    </div>
  )
}

function LiveModuleCard({
  module,
  applications,
  setModuleEnabled,
}: {
  module: IntegrationModuleRow
  applications: IntegrationApplication[]
  setModuleEnabled: (slug: string, enabled: boolean) => Promise<unknown>
}) {
  const { t } = useTranslation('nav')
  const name = t(`integrations.modules.${module.slug}.name`, { defaultValue: module.name })
  const description = t(`integrations.modules.${module.slug}.description`, {
    defaultValue: module.description,
  })
  const on = moduleIsOn(module)
  const connected = module.tenant_status === 'connected' || Boolean(module.connected)
  const needsPackage = on && !connected

  return (
    <article className="rounded-xl border border-border/60 bg-bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-text-heading">{name}</h2>
            <ModuleStatusBadge module={module} />
          </div>
          <p className="mt-1 text-sm text-text-secondary">{description}</p>
        </div>
        <ModulePowerSwitch module={module} onToggle={setModuleEnabled} />
      </div>

      {needsPackage ? (
        <p className="mt-3 rounded-lg border border-accent/30 bg-accent/8 px-3 py-2 text-xs text-text-primary">
          {t('integrations.modules.nextConnect', {
            defaultValue: '{{name}} is on. Connect a package so agents can use it.',
            name,
          })}
        </p>
      ) : (
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
      )}

      {module.verb_labels && module.verb_labels.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
              {module.verb_labels.map((label) => (
            <li
              key={label}
              className="rounded-full border border-border/60 px-2.5 py-0.5 text-xs text-text-secondary"
            >
              {t(`integrations.modules.verbs.${verbLabelKey(label)}`, { defaultValue: label })}
            </li>
          ))}
        </ul>
      ) : null}

      <ConnectorShowcase module={module} applications={applications} />

      <div className="mt-4">
        <Link
          to={moduleHomePath(module)}
          className="text-xs font-medium text-accent hover:underline"
        >
          {needsPackage
            ? t('integrations.modules.connectCta', {
                defaultValue: 'Connect a package',
              })
            : on
              ? t('integrations.modules.manageCta', {
                  defaultValue: 'Manage {{name}}',
                  name,
                })
              : t('integrations.modules.setupCta', {
                  defaultValue: 'Set up {{name}}',
                  name,
                })}
        </Link>
      </div>
    </article>
  )
}

export default function ModulesPage() {
  const { t } = useTranslation(['nav', 'common'])
  const { applications, modules, loadError, refreshCatalog, setModuleEnabled } =
    useIntegrationCatalog()
  const live = modules.filter((module) => module.status !== 'coming_soon')
  const later = modules.filter((module) => module.status === 'coming_soon')
  const onCount = live.filter((module) => moduleIsOn(module)).length

  return (
    <PageContent width="lg">
      <div className="mb-6">
        <p className="max-w-2xl text-sm text-text-secondary">
          {t('integrations.modules.pageIntro', {
            defaultValue:
              'Turn a business module on so agents can use it. Then connect the package you already use.',
          })}
        </p>
        {live.length > 0 ? (
          <p className="mt-2 text-xs text-text-muted">
            {t('integrations.modules.readyCount', {
              defaultValue: '{{on}} of {{total}} ready modules are on',
              on: onCount,
              total: live.length,
              count: onCount,
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

      {modules.length === 0 ? (
        <CardGridSkeleton cards={2} />
      ) : (
        <div className="space-y-8">
          <div className="space-y-4">
            {live.map((module) => (
              <LiveModuleCard
                key={module.slug}
                module={module}
                applications={applications}
                setModuleEnabled={setModuleEnabled}
              />
            ))}
          </div>

          {later.length > 0 ? (
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                {t('integrations.modules.laterTitle', { defaultValue: 'Coming later' })}
              </h3>
              <div className="space-y-3">
                {later.map((module) => {
                  const name = t(`integrations.modules.${module.slug}.name`, {
                    defaultValue: module.name,
                  })
                  const description = t(`integrations.modules.${module.slug}.description`, {
                    defaultValue: module.description,
                  })
                  const planned = module.planned_provider_slugs ?? []
                  return (
                    <article
                      key={module.slug}
                      className="rounded-xl border border-dashed border-border/50 bg-bg-muted/30 p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to={moduleHomePath(module)}
                          className="text-sm font-semibold text-text-secondary hover:text-text-primary hover:underline"
                        >
                          {name}
                        </Link>
                        <ModuleStatusBadge module={module} />
                      </div>
                      <p className="mt-1 text-xs text-text-muted">{description}</p>
                      {planned.length > 0 ? (
                        <p className="mt-2 text-xs text-text-muted">
                          {t('integrations.modules.planned', {
                            defaultValue: 'Planned connectors: {{providers}}',
                            providers: planned.map(plannedProviderLabel).join(', '),
                          })}
                        </p>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            </section>
          ) : null}

          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
            <Link to="/settings/marketplace" className="text-accent hover:underline">
              {t('integrations.modules.browseMarketplace', {
                defaultValue: 'Browse packages on Marketplace',
              })}
            </Link>
            <Link to="/docs/integrations/integrations" className="hover:underline">
              {t('integrations.modules.helpLink', {
                defaultValue: 'How modules work',
              })}
            </Link>
          </p>
        </div>
      )}
    </PageContent>
  )
}
