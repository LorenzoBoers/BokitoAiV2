import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Link2, Pencil, Wallet, Workflow } from 'lucide-react'
import { Card, CardContent, CardHeader, CardHeaderActions, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { ProjectBudgetEditor } from './ProjectBudgetEditor'
import {
  ProjectAgentEditButton,
  ProjectOrchestratorSection,
} from './ProjectOrchestratorSection'
import { ProjectCasesBoard } from './ProjectCasesBoard'
import { ProjectResourcesSection } from './ProjectResourcesSection'
import { workstreamPath } from '../../lib/workstream-ui'
import { flowStatusLabel } from '../../lib/status-labels'
import type { ProjectBudgetResponse, ProjectRow } from '../../lib/projects-api'
import type { RuntimeAgent } from '../../lib/workforce-api'
import type { WorkstreamRow } from '../../lib/workstreams-api'

export function ProjectHome({
  project,
  budget,
  workstreams,
  agents,
  canEdit,
  onChanged,
}: {
  project: ProjectRow
  budget: ProjectBudgetResponse | null
  workstreams: WorkstreamRow[]
  agents: RuntimeAgent[]
  canEdit: boolean
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation('nav')
  const [budgetOpen, setBudgetOpen] = useState(false)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>{t('projects.detail.leadLabel')}</CardTitle>
            {canEdit ? (
              <CardHeaderActions>
                <ProjectAgentEditButton project={project} agents={agents} onChanged={onChanged} />
              </CardHeaderActions>
            ) : null}
          </CardHeader>
          <CardContent className="text-sm">
            <ProjectOrchestratorSection project={project} agents={agents} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet size={16} className="shrink-0 text-text-muted" />
              {t('projects.detail.budgetTitle')}
            </CardTitle>
            {canEdit ? (
              <CardHeaderActions>
                <Button
                  type="button"
                  variant="ghost"
                  size="iconSm"
                  onClick={() => setBudgetOpen(true)}
                  aria-label={t('projects.detail.editBudget')}
                  title={t('projects.detail.editBudget')}
                >
                  <Pencil size={14} />
                </Button>
              </CardHeaderActions>
            ) : null}
          </CardHeader>
          <CardContent>
            <ProjectBudgetEditor
              projectId={project.id}
              budget={budget}
              canEdit={canEdit}
              onChanged={onChanged}
              editOpen={budgetOpen}
              onEditOpenChange={setBudgetOpen}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Workflow size={16} className="shrink-0 text-text-muted" />
              {t('projects.detail.workstreams')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {workstreams.length === 0 ? (
              <p className="text-sm text-text-muted">{t('projects.detail.noWorkstreams')}</p>
            ) : (
              <ul className="space-y-1">
                {workstreams.slice(0, 4).map((stream) => (
                  <li key={stream.id}>
                    <Link
                      to={workstreamPath(stream.id)}
                      className="flex items-center justify-between gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-bg-hover"
                    >
                      <span className="truncate-fade text-text-primary">{stream.name}</span>
                      <Badge variant={stream.enabled ? 'secondary' : 'outline'} className="px-1.5 py-0 text-2xs">
                        {flowStatusLabel(stream.enabled, t)}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Button type="button" size="sm" variant="ghost" asChild>
              <Link to="/workstreams">{t('projects.detail.openWorkstreams')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('projects.home.signalsBoard')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-text-muted">{t('projects.home.signalsHint')}</p>
          <ProjectCasesBoard projectId={project.id} canEdit={canEdit} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 size={16} className="shrink-0 text-text-muted" />
            {t('projects.detail.resources')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-text-muted">{t('projects.home.resourcesHint')}</p>
          <ProjectResourcesSection projectId={project.id} canEdit={false} />
        </CardContent>
      </Card>
    </div>
  )
}
