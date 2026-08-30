import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Settings2 } from 'lucide-react'
import { PageContent } from '../layout/PageContent'
import { Button } from '../ui/button'
import { ModuleStatusBadge } from '../integrations/ModuleStatusBadge'
import { ModuleToolsetDropdown } from '../integrations/ModuleToolsetDropdown'
import { moduleHomePath, type IntegrationModuleRow } from '../../lib/integration-modules'

type Props = {
  module: IntegrationModuleRow
  title: string
  description: string
  children: React.ReactNode
}

/**
 * Universal shell for installed module workspaces under `/ai/modules/:slug`.
 * Module-specific panels go in `children`.
 */
export function ModuleWorkspaceShell({ module, title, description, children }: Props) {
  const { t } = useTranslation('nav')
  const capability = t(`integrations.modules.${module.slug}.capability`, {
    defaultValue: module.capability_summary || '',
  })

  return (
    <PageContent width="lg">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-border/40 pb-5">
        <div className="min-w-0 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-text-heading">{title}</h1>
            <ModuleStatusBadge module={module} />
          </div>
          <p className="mt-1 text-sm text-text-secondary">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ModuleToolsetDropdown
            moduleSlug={module.slug}
            verbLabels={module.verb_labels ?? []}
            verbs={module.verbs}
            proposeVerbs={module.propose_verbs}
            capability={capability}
          />
          <Button type="button" size="sm" variant="outline" asChild>
            <Link to={moduleHomePath(module)}>
              <Settings2 size={14} className="mr-1.5" aria-hidden />
              {t('integrations.modules.manageCta', {
                defaultValue: 'Manage {{name}}',
                name: title,
              })}
            </Link>
          </Button>
        </div>
      </header>
      {children}
    </PageContent>
  )
}
