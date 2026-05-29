import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { Button } from '../ui/button'
import { projectOrchestratorPath } from '../layout/portal-nav'

type ProjectRequiredPoBannerProps = {
  projectId: string
  className?: string
}

export function ProjectRequiredPoBanner({ projectId, className }: ProjectRequiredPoBannerProps) {
  const { t } = useTranslation('nav')

  return (
    <div
      className={
        className ??
        'flex flex-col gap-3 rounded-lg border border-status-warning/40 bg-status-warning/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between'
      }
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-status-warning" />
        <div>
          <p className="text-sm font-medium text-text-heading">
            {t('project.po.required.title', { defaultValue: 'Set up an orchestrator' })}
          </p>
          <p className="mt-0.5 text-sm text-text-muted">
            {t('project.po.required.description', {
              defaultValue:
                'This project needs a dedicated orchestrator before workstreams and orchestration can run.',
            })}
          </p>
        </div>
      </div>
      <Button size="sm" asChild className="shrink-0">
        <Link to={projectOrchestratorPath(projectId)}>
          {t('project.po.required.cta', { defaultValue: 'Set up orchestrator' })}
        </Link>
      </Button>
    </div>
  )
}
