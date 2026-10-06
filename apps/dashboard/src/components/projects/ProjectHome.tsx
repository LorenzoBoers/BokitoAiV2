import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Wallet } from 'lucide-react'
import { Card, CardContent, CardHeader, CardHeaderActions, CardTitle } from '../ui/card'
import { Button } from '../ui/button'
import { ProjectAgendaCard } from './ProjectAgendaCard'
import { ProjectBudgetEditor } from './ProjectBudgetEditor'
import {
  ProjectAgentEditButton,
  ProjectOrchestratorSection,
} from './ProjectOrchestratorSection'
import { ProjectFlowBoards } from './ProjectFlowBoards'
import type { ProjectBudgetResponse, ProjectRow } from '../../lib/projects-api'
import type { RuntimeAgent } from '../../lib/workforce-api'

export function ProjectHome({
  project,
  budget,
  agents,
  canEdit,
  onChanged,
}: {
  project: ProjectRow
  budget: ProjectBudgetResponse | null
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

        <ProjectAgendaCard projectId={project.id} />

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
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('projects.home.ticketsBoard')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-text-muted">{t('projects.home.ticketsHint')}</p>
          <ProjectFlowBoards projectId={project.id} canEdit={canEdit} onFlowsChanged={() => void onChanged()} />
        </CardContent>
      </Card>
    </div>
  )
}
