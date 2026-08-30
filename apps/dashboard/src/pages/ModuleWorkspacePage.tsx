import { useMemo } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useIntegrationCatalog } from '../hooks/useIntegrationCatalog'
import { ModuleWorkspaceShell } from '../components/modules/ModuleWorkspaceShell'
import { AccountingModuleOverview } from '../components/modules/AccountingModuleOverview'
import { ModuleInstallControls } from '../components/integrations/ModuleInstallControls'
import { PageContent } from '../components/layout/PageContent'
import { EmptyState } from '../components/ui/empty-state'
import { CardGridSkeleton } from '../components/ui/skeleton'
import {
  moduleHomePath,
  moduleIsInSetup,
  moduleIsOn,
} from '../lib/integration-modules'

/**
 * Installed-module workspace at `/ai/modules/:slug`.
 * Universal shell + per-slug overview panels.
 */
export default function ModuleWorkspacePage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const { t } = useTranslation(['nav', 'common'])
  const { applications, modules, loadError, refreshCatalog, runModuleAction } =
    useIntegrationCatalog()

  const module = useMemo(
    () => modules.find((row) => row.slug === slug) ?? null,
    [modules, slug],
  )

  if (modules.length === 0 && !loadError) {
    return (
      <PageContent width="lg">
        <CardGridSkeleton cards={2} />
      </PageContent>
    )
  }

  if (!module) {
    return (
      <PageContent width="lg">
        <EmptyState
          title={t('integrations.modules.workspace.missing', {
            defaultValue: 'Module not found',
          })}
          description={t('integrations.modules.workspace.missingBody', {
            defaultValue: 'This module is not in the catalog.',
          })}
          action={
            <Link to="/modules" className="text-sm text-accent hover:underline">
              {t('integrations.modules.workspace.backToCatalog', {
                defaultValue: 'Back to Modules',
              })}
            </Link>
          }
        />
      </PageContent>
    )
  }

  if (module.user_accessible === false) {
    return (
      <PageContent width="lg">
        <EmptyState
          title={t('integrations.modules.workspace.noAccess', {
            defaultValue: 'No access to this module',
          })}
          description={t('integrations.modules.workspace.noAccessBody', {
            defaultValue: 'An owner or admin can grant you access under Settings > Modules.',
          })}
        />
      </PageContent>
    )
  }

  const name = t(`integrations.modules.${module.slug}.name`, { defaultValue: module.name })
  const description = t(`integrations.modules.${module.slug}.description`, {
    defaultValue: module.description,
  })
  const installed = moduleIsOn(module)
  const inSetup = moduleIsInSetup(module)

  if (!installed) {
    return (
      <PageContent width="lg">
        <EmptyState
          title={
            inSetup
              ? t('integrations.modules.workspace.finishFirst', {
                  defaultValue: 'Finish setup for {{name}}',
                  name,
                })
              : t('integrations.modules.workspace.installFirst', {
                  defaultValue: 'Install {{name}} first',
                  name,
                })
          }
          description={
            inSetup
              ? t('integrations.modules.workspace.finishFirstBody', {
                  defaultValue:
                    'Complete setup under Settings > Modules before opening the workspace.',
                })
              : t('integrations.modules.workspace.installFirstBody', {
                  defaultValue: 'Install this module from the catalog, then return here from AI.',
                })
          }
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <ModuleInstallControls module={module} onAction={runModuleAction} />
              <Link to={moduleHomePath(module)} className="text-sm text-accent hover:underline">
                {t('integrations.modules.continueSetup', { defaultValue: 'Continue setup' })}
              </Link>
            </div>
          }
        />
      </PageContent>
    )
  }

  if (module.status === 'coming_soon') {
    return <Navigate to={moduleHomePath(module)} replace />
  }

  return (
    <ModuleWorkspaceShell module={module} title={name} description={description}>
      {loadError ? (
        <p className="mb-4 text-xs text-text-muted">
          {loadError}{' '}
          <button type="button" className="text-accent hover:underline" onClick={() => void refreshCatalog()}>
            {t('common:actions.retry')}
          </button>
        </p>
      ) : null}
      {module.slug === 'accounting' ? (
        <AccountingModuleOverview module={module} applications={applications} />
      ) : (
        <p className="text-sm text-text-secondary">
          {t('integrations.modules.workspace.genericBody', {
            defaultValue:
              'This module is installed. Open Manage for connections, sources, and setup. A richer workspace ships with the next connectors.',
          })}
        </p>
      )}
    </ModuleWorkspaceShell>
  )
}
