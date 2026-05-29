import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bot } from 'lucide-react'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { ProjectShell } from './ProjectShell'
import { projectOrchestratorPath } from '../layout/portal-nav'

type ProjectRequiredPoGateProps = {
  projectId: string
  title?: string
  description?: string
}

export function ProjectRequiredPoGate({ projectId, title, description }: ProjectRequiredPoGateProps) {
  const { t } = useTranslation('nav')

  return (
    <ProjectShell hideContextBar hideTabNav hideWorkerStatus>
      <Card className="mx-auto max-w-lg border-border/80 p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-bg-hover">
          <Bot size={22} className="text-text-muted" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-text-heading">
          {title ?? t('project.po.gate.title', { defaultValue: 'Orchestrator required' })}
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          {description ??
            t('project.po.gate.description', {
              defaultValue: 'Link or create an orchestrator for this project to continue.',
            })}
        </p>
        <Button className="mt-5" asChild>
          <Link to={projectOrchestratorPath(projectId)}>
            {t('project.po.required.cta', { defaultValue: 'Set up orchestrator' })}
          </Link>
        </Button>
      </Card>
    </ProjectShell>
  )
}
