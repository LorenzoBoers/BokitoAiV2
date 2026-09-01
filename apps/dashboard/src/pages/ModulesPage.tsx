import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useIntegrationCatalog } from '../hooks/useIntegrationCatalog'
import { ModuleStatusBadge } from '../components/integrations/ModuleStatusBadge'
import { PageContent } from '../components/layout/PageContent'
import IntegrationsTabs from '../components/shell/IntegrationsTabs'
import { Button } from '../components/ui/button'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { moduleHomePath, moduleIsOn } from '../lib/integration-modules'
import type { IntegrationModuleRow } from '../lib/integrations-api'

function CompactModuleCard({ module }: { module: IntegrationModuleRow }) {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const name = t(`integrations.modules.${module.slug}.name`, { defaultValue: module.name })
  const description = t(`integrations.modules.${module.slug}.description`, {
    defaultValue: module.description,
  })
  const attached = module.attached_connection_count ?? 0
  const comingSoon = module.status === 'coming_soon'

  return (
    <button
      type="button"
      onClick={() => navigate(moduleHomePath(module))}
      className={`w-full rounded-xl border p-4 text-left shadow-card transition-colors hover:border-accent/40 hover:bg-bg-hover/30 ${
        comingSoon ? 'border-dashed border-border/50 bg-bg-muted/30' : 'border-border/60 bg-bg-surface'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-xl">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-text-heading">{name}</h2>
            <ModuleStatusBadge module={module} />
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{description}</p>
        </div>
        {!comingSoon ? (
          <span className="shrink-0 text-[11px] text-text-muted">
            {t('integrations.modules.attachedCount', {
              defaultValue: '{{count}} connections',
              count: attached,
            })}
          </span>
        ) : null}
      </div>
    </button>
  )
}

export default function ModulesPage() {
  const { t } = useTranslation(['nav', 'common'])
  const { modules, loadError, refreshCatalog } = useIntegrationCatalog()
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
              'Modules are presets for a field of work. Connections are partner logins. Attach a connection only when that partner is defined on the module.',
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
          <div className="grid gap-3 sm:grid-cols-2">
            {live.map((module) => (
              <CompactModuleCard key={module.slug} module={module} />
            ))}
          </div>

          {later.length > 0 ? (
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                {t('integrations.modules.laterTitle', { defaultValue: 'Coming later' })}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {later.map((module) => (
                  <CompactModuleCard key={module.slug} module={module} />
                ))}
              </div>
            </section>
          ) : null}

          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
            <Link to="/modules/connected" className="text-accent hover:underline">
              {t('integrations.modules.openConnections', {
                defaultValue: 'Open Connections',
              })}
            </Link>
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
