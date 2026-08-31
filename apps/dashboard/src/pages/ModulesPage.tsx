import { Link, useNavigate } from 'react-router-dom'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useIntegrationCatalog } from '../hooks/useIntegrationCatalog'
import { inboxPath } from '../lib/messages-paths'
import { ModuleInstallControls } from '../components/integrations/ModuleInstallControls'
import { ModuleStatusBadge } from '../components/integrations/ModuleStatusBadge'
import { ModuleToolsetDropdown } from '../components/integrations/ModuleToolsetDropdown'
import { ModuleToolsetPanel } from '../components/integrations/ModuleToolsetPanel'
import {
  ModulePackageGrid,
  buildModulePackageItems,
  type ModulePackageItem,
} from '../components/integrations/ModulePackageGrid'
import { PageContent } from '../components/layout/PageContent'
import IntegrationsTabs from '../components/shell/IntegrationsTabs'
import { Button } from '../components/ui/button'
import { CardGridSkeleton } from '../components/ui/skeleton'
import {
  moduleHomePath,
  moduleIsInSetup,
  moduleIsOn,
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
  onOpenPackage,
}: {
  module: IntegrationModuleRow
  applications: IntegrationApplication[]
  onOpenPackage: (item: ModulePackageItem) => void
}) {
  const { t } = useTranslation('nav')
  const items = useMemo(() => {
    const moduleApps = applications.filter((app) => app.module === module.slug)
    return buildModulePackageItems(moduleApps, module.planned_provider_slugs ?? [])
  }, [applications, module.slug, module.planned_provider_slugs])
  if (items.length === 0) return null

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
      <ModulePackageGrid items={items} onOpen={onOpenPackage} />
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
  const navigate = useNavigate()
  const name = t(`integrations.modules.${module.slug}.name`, { defaultValue: module.name })
  const description = t(`integrations.modules.${module.slug}.description`, {
    defaultValue: module.description,
  })
  const installed = moduleIsOn(module)
  const inSetup = moduleIsInSetup(module)
  const connected = module.tenant_status === 'connected' || Boolean(module.connected)

  const openPackage = (item: ModulePackageItem) => {
    if (!item.application) return
    navigate(moduleSetupPath(module.slug, packageConnectId(item.application), 'setup'))
  }

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
        <div className="flex flex-wrap items-center gap-2">
          <ModuleToolsetDropdown module={module} />
          <ModuleInstallControls module={module} onAction={runModuleAction} />
        </div>
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

      <div className="mt-4">
        <ModuleToolsetPanel module={module} />
      </div>

      <UsesIntegrations
        module={module}
        applications={applications}
        onOpenPackage={openPackage}
      />

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link
          to={moduleHomePath(module)}
          className="text-xs font-medium text-accent hover:underline"
        >
          {inSetup
            ? t('integrations.modules.continueSetup', { defaultValue: 'Continue setup' })
            : installed
              ? t('integrations.modules.openWorkspace', {
                  defaultValue: 'Open {{name}}',
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
      <IntegrationsTabs />
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
                  const moduleApps = applications.filter((app) => app.module === module.slug)
                  const items = buildModulePackageItems(
                    moduleApps,
                    module.planned_provider_slugs ?? [],
                  )
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
                      {items.length > 0 ? (
                        <ModulePackageGrid items={items} className="mt-3" />
                      ) : null}
                    </article>
                  )
                })}
              </div>
            </section>
          ) : null}

          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
            <Link to="/modules/marketplace" className="text-accent hover:underline">
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
