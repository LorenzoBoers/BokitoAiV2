import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useIntegrationCatalog } from '../hooks/useIntegrationCatalog'
import { inboxPath } from '../lib/messages-paths'
import { ModuleInstallControls } from '../components/integrations/ModuleInstallControls'
import { ModuleStatusBadge } from '../components/integrations/ModuleStatusBadge'
import { ModuleToolsetDropdown } from '../components/integrations/ModuleToolsetDropdown'
import { IntegrationHostLogo } from '../components/integrations/IntegrationHostLogo'
import { PageContent } from '../components/layout/PageContent'
import { Button } from '../components/ui/button'
import { CardGridSkeleton } from '../components/ui/skeleton'
import {
  moduleHomePath,
  moduleIsInSetup,
  moduleIsOn,
  moduleWorkspacePath,
  plannedProviderLabel,
} from '../lib/integration-modules'
import { moduleSetupPath } from '../lib/integration-setup-url'
import type { IntegrationApplication } from '../lib/integration-applications'
import type { IntegrationModuleRow } from '../lib/integrations-api'

function packageConnectId(app: IntegrationApplication): string {
  return app.offers[0]?.integration.id || app.hostSlug
}

function UsesIntegrations({
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
        {t('integrations.modules.usesIntegrations', { defaultValue: 'Uses integrations' })}
      </p>
      <p className="mb-2 text-xs text-text-muted">
        {t('integrations.modules.usesIntegrationsHint', {
          defaultValue:
            'Connect these on the platform. The module uses them when they are available.',
        })}
      </p>
      {apps.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-2">
          {apps.map((app) => {
            const connected = (app.connectionCount ?? 0) > 0 || app.status === 'connected'
            return (
              <li key={app.hostSlug}>
                <Link
                  to={moduleSetupPath(module.slug, packageConnectId(app), 'setup')}
                  aria-label={t('integrations.modules.openIntegration', {
                    defaultValue: 'Open {{name}}',
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
                  <span
                    className={`text-[10px] ${connected ? 'text-status-success' : 'text-text-muted'}`}
                  >
                    {connected
                      ? t('integrations.modules.integrationOn', { defaultValue: 'On' })
                      : t('integrations.modules.integrationOff', { defaultValue: 'Optional' })}
                  </span>
                </Link>
              </li>
            )
          })}
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
  runModuleAction,
}: {
  module: IntegrationModuleRow
  applications: IntegrationApplication[]
  runModuleAction: (
    slug: string,
    action: 'install' | 'complete_setup' | 'uninstall',
  ) => Promise<unknown>
}) {
  const { t } = useTranslation('nav')
  const name = t(`integrations.modules.${module.slug}.name`, { defaultValue: module.name })
  const description = t(`integrations.modules.${module.slug}.description`, {
    defaultValue: module.description,
  })
  const capability = t(`integrations.modules.${module.slug}.capability`, {
    defaultValue: module.capability_summary || '',
  })
  const installed = moduleIsOn(module)
  const inSetup = moduleIsInSetup(module)
  const connected = module.tenant_status === 'connected' || Boolean(module.connected)

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
        <ModuleInstallControls module={module} onAction={runModuleAction} />
      </div>

      {inSetup ? (
        <p className="mt-3 rounded-lg border border-accent/30 bg-accent/8 px-3 py-2 text-xs text-text-primary">
          {t('integrations.modules.setupInProgress', {
            defaultValue:
              'Finish setup to install {{name}}. Optionally link a platform integration it can use.',
            name,
          })}
        </p>
      ) : installed && !connected ? (
        <p className="mt-3 rounded-lg border border-border/50 bg-bg-muted/40 px-3 py-2 text-xs text-text-secondary">
          {t('integrations.modules.installedNoIntegration', {
            defaultValue:
              '{{name}} is installed. Link an optional integration so agents can reach live data.',
            name,
          })}
        </p>
      ) : (
        <p className="mt-2 text-xs text-text-muted">
          {installed
            ? t('integrations.modules.installedHint', {
                defaultValue:
                  'Installed modules appear under AI in the main menu. Uninstall removes them from agents.',
              })
            : t('integrations.modules.installHint', {
                defaultValue:
                  'Install this module, complete setup, then open it from AI > Modules.',
              })}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ModuleToolsetDropdown
          moduleSlug={module.slug}
          verbLabels={module.verb_labels ?? []}
          verbs={module.verbs}
          proposeVerbs={module.propose_verbs}
          capability={capability}
        />
      </div>

      <UsesIntegrations module={module} applications={applications} />

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {installed ? (
          <Link
            to={moduleWorkspacePath(module)}
            className="text-xs font-medium text-accent hover:underline"
          >
            {t('integrations.modules.openWorkspace', {
              defaultValue: 'Open {{name}}',
              name,
            })}
          </Link>
        ) : null}
        <Link
          to={moduleHomePath(module)}
          className="text-xs font-medium text-accent hover:underline"
        >
          {inSetup
            ? t('integrations.modules.continueSetup', { defaultValue: 'Continue setup' })
            : installed
              ? t('integrations.modules.manageCta', {
                  defaultValue: 'Manage {{name}}',
                  name,
                })
              : t('integrations.modules.setupCta', {
                  defaultValue: 'View {{name}}',
                  name,
                })}
        </Link>
        {installed ? (
          <>
            <Link to="/agents" className="text-xs text-text-muted hover:text-accent hover:underline">
              {t('integrations.connected.openAgents', { defaultValue: 'Open Agents' })}
            </Link>
            <Link
              to={inboxPath('open')}
              className="text-xs text-text-muted hover:text-accent hover:underline"
            >
              {t('integrations.connected.openCommunication', { defaultValue: 'Open Communication' })}
            </Link>
            <Link
              to="/settings/govern?tab=policy"
              className="text-xs text-text-muted hover:text-accent hover:underline"
            >
              {t('integrations.connected.openGovern', { defaultValue: 'Open Govern' })}
            </Link>
          </>
        ) : null}
      </div>
    </article>
  )
}

export default function ModulesPage() {
  const { t } = useTranslation(['nav', 'common'])
  const { applications, modules, loadError, refreshCatalog, runModuleAction } =
    useIntegrationCatalog()
  const live = modules.filter((module) => module.status !== 'coming_soon')
  const later = modules.filter((module) => module.status === 'coming_soon')
  const installedCount = live.filter((module) => moduleIsOn(module)).length

  return (
    <PageContent width="lg">
      <div className="mb-6">
        <p className="max-w-2xl text-sm text-text-secondary">
          {t('integrations.modules.pageIntro', {
            defaultValue:
              'Install a business module, assign at least one AI agent, optionally link integrations, finish setup, then open the module from AI. Only assigned agents get the module tools.',
          })}
        </p>
        {live.length > 0 ? (
          <p className="mt-2 text-xs text-text-muted">
            {t('integrations.modules.readyCount', {
              defaultValue: '{{on}} of {{total}} modules installed',
              on: installedCount,
              total: live.length,
              count: installedCount,
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
                runModuleAction={runModuleAction}
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
                defaultValue: 'Browse integrations on Marketplace',
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
