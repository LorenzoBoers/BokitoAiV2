import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Bot, GripHorizontal, MessageSquare, Plus, Settings2, Sparkles } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Card } from '../components/ui/card'
import { LoadingBlock } from '../components/ui/loading-block'
import { EmptyState } from '../components/ui/empty-state'
import { ProjectShell } from '../components/project/ProjectShell'
import { ProjectRequiredPoGate } from '../components/project/ProjectRequiredPoGate'
import AddWorkstreamDialog from '../components/project/AddWorkstreamDialog'
import { useProjectContext } from '../context/ProjectContext'
import { useProjectHubNav } from '../context/ProjectHubNavContext'
import type { ProjectWorkstreamRow, WorkstreamStep } from '../lib/workstreams-api'
import { projectCommunicationPath } from '../components/layout/portal-nav'

const OVERVIEW_TOOL_KEYS = ['github', 'outlook', 'gmail', 'mcp'] as const

function normalizeSteps(stream: ProjectWorkstreamRow): WorkstreamStep[] {
  if (!Array.isArray(stream.steps)) return []
  return stream.steps
    .map((step) => ({
      id: String(step.id ?? ''),
      name: String(step.name ?? ''),
      role_label: String(step.role_label ?? ''),
      instruction: String(step.instruction ?? ''),
      tool_keys: Array.isArray(step.tool_keys) ? step.tool_keys.map(String) : [],
    }))
    .filter((step) => step.id && step.name)
}

export default function ProjectOverview() {
  const { t } = useTranslation(['nav', 'common'])
  const { projectId, project, loading: projectLoading } = useProjectContext()
  const {
    poAgent,
    workstreams,
    workstreamsLoading,
    workstreamsError,
    refreshWorkstreams,
    setSelectedProjectId,
  } = useProjectHubNav()
  const [searchParams, setSearchParams] = useSearchParams()
  const [addStreamOpen, setAddStreamOpen] = useState(false)

  useEffect(() => {
    if (projectId) setSelectedProjectId(projectId)
  }, [projectId, setSelectedProjectId])

  useEffect(() => {
    if (projectId) void refreshWorkstreams()
  }, [projectId, refreshWorkstreams])

  useEffect(() => {
    if (workstreams.length === 0) return
    if (searchParams.get('stream')) return
    const next = new URLSearchParams(searchParams)
    next.set('stream', workstreams[0].slug)
    setSearchParams(next, { replace: true })
  }, [workstreams, searchParams, setSearchParams])

  const selectedStreamSlug = searchParams.get('stream') ?? workstreams[0]?.slug ?? null
  const selectedStream =
    workstreams.find((stream) => stream.slug === selectedStreamSlug) ?? workstreams[0] ?? null

  const toolByKey = useMemo(
    () =>
      new Map(
        OVERVIEW_TOOL_KEYS.map((key) => [
          key,
          t(`project.overview.tools.${key}`, { defaultValue: key.toUpperCase() }),
        ]),
      ),
    [t],
  )

  const steps = selectedStream ? normalizeSteps(selectedStream) : []
  const hasOrchestrator = Boolean(poAgent || project?.po_agent_id)
  const defaultInputLabel = t('project.overview.inputChip', {
    defaultValue: 'in: project context + orchestrator trigger',
  })
  const defaultOutputLabel = t('project.overview.outputChip', {
    defaultValue: 'out: stream report to orchestrator',
  })
  const inputText = selectedStream?.trigger_text?.trim() ?? ''
  const outputText = selectedStream?.output_text?.trim() ?? ''

  if (!workstreamsLoading && !projectLoading && !hasOrchestrator) {
    return <ProjectRequiredPoGate projectId={projectId} />
  }

  if (!hasOrchestrator) {
    return (
      <ProjectShell width="wide" hideContextBar hideTabNav hideWorkerStatus>
        <LoadingBlock label={t('project.po.loading', { defaultValue: 'Loading orchestrator settings…' })} />
      </ProjectShell>
    )
  }

  if (workstreamsLoading && workstreams.length === 0) {
    return (
      <ProjectShell width="wide" hideContextBar hideTabNav hideWorkerStatus>
        <LoadingBlock label={t('backgroundWorkers.loading')} />
      </ProjectShell>
    )
  }

  if (workstreamsError && workstreams.length === 0) {
    return (
      <ProjectShell width="wide" hideContextBar hideTabNav hideWorkerStatus>
        <Card className="p-4">
          <p className="text-sm text-status-error">{workstreamsError}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => void refreshWorkstreams()}>
            {t('common:actions.retry', { defaultValue: 'Retry' })}
          </Button>
        </Card>
      </ProjectShell>
    )
  }

  if (!selectedStream) {
    return (
      <ProjectShell width="wide" hideContextBar hideTabNav hideWorkerStatus>
        <EmptyState
          title={t('backgroundWorkers.emptyTitle', { defaultValue: 'No workstreams yet' })}
          description={t('backgroundWorkers.emptyDescription')}
          action={
            <Button size="sm" onClick={() => setAddStreamOpen(true)}>
              <Plus size={14} className="mr-1.5" />
              {t('project.overview.addStream', { defaultValue: 'Add workstream' })}
            </Button>
          }
        />
        <AddWorkstreamDialog open={addStreamOpen} onOpenChange={setAddStreamOpen} projectId={projectId} />
      </ProjectShell>
    )
  }

  return (
    <ProjectShell width="wide" hideContextBar hideTabNav hideWorkerStatus>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <Button size="sm" variant="ghost" asChild>
          <Link to={projectCommunicationPath(projectId, selectedStream.slug)}>
            <MessageSquare size={14} className="mr-1.5" />
            {t('project.overview.openStreamCommunication', { defaultValue: 'Open stream communication' })}
          </Link>
        </Button>
        <Button variant="secondary" size="sm" asChild>
          <Link to={`/project/${projectId}/orchestration`}>
            <Settings2 size={14} className="mr-1.5" />
            {t('project.links.orchestration', { defaultValue: 'Orchestration' })}
          </Link>
        </Button>
        <Button variant="secondary" size="sm" disabled>
          <Plus size={14} className="mr-1.5" />
          {t('project.overview.addStep', { defaultValue: 'Add step' })}
        </Button>
        <Button variant="ghost" size="sm" disabled>
          <GripHorizontal size={14} className="mr-1.5" />
          {t('project.overview.dragPreview', { defaultValue: 'Drag preview' })}
        </Button>
      </div>

      <div className="grid gap-3 xl:grid-cols-[220px_minmax(0,1fr)_220px]">
        <Card className="border-border/70 bg-bg-input/35 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">
            {t('project.overview.inputTitle', { defaultValue: 'Input' })}
          </p>
          {inputText ? (
            <p className="mt-2 text-sm font-medium text-text-heading">{inputText}</p>
          ) : (
            <Badge className="mt-3 w-fit" variant="info">
              {defaultInputLabel}
            </Badge>
          )}
        </Card>

        <Card className="overflow-x-auto border-border/70 bg-bg-input/30 p-4">
          <div className="flex min-w-max items-start gap-3">
            {steps.length === 0 ? (
              <p className="text-sm text-text-muted">
                {t('project.overview.emptySteps', { defaultValue: 'No steps configured for this workstream yet.' })}
              </p>
            ) : (
              steps.map((step, idx) => (
                <div key={step.id} className="flex items-start gap-3">
                  <div className="w-[260px] rounded-xl border border-border/70 bg-bg-surface/95 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs uppercase tracking-[0.08em] text-text-muted">
                          {t('project.overview.stepLabel', { defaultValue: 'Step' })} {idx + 1}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-text-heading">{step.name}</p>
                      </div>
                      <Bot size={14} className="text-text-muted" />
                    </div>
                    <div className="mt-3">
                      <p className="text-[11px] uppercase tracking-[0.08em] text-text-muted">
                        {t('project.overview.agentLabel', { defaultValue: 'Agent' })}
                      </p>
                      <p className="mt-1 text-sm text-text-primary">{step.role_label}</p>
                    </div>
                    <div className="mt-3">
                      <p className="text-[11px] uppercase tracking-[0.08em] text-text-muted">
                        {t('project.overview.instructionLabel', { defaultValue: 'Instruction' })}
                      </p>
                      <p className="mt-1 text-sm text-text-secondary">{step.instruction}</p>
                    </div>
                    <div className="mt-3">
                      <p className="text-[11px] uppercase tracking-[0.08em] text-text-muted">
                        {t('project.overview.toolsLabel', { defaultValue: 'Tools (tenant integrations)' })}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {step.tool_keys.map((toolKey) => (
                          <Badge key={`${step.id}-${toolKey}`} variant="neutral" className="text-[11px]">
                            <Sparkles size={11} className="mr-1" />
                            {toolByKey.get(toolKey as (typeof OVERVIEW_TOOL_KEYS)[number]) ??
                              t('project.overview.selectTool', { defaultValue: 'Select tool' })}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                  {idx < steps.length - 1 ? (
                    <div className="flex h-[204px] items-center">
                      <ArrowRight size={16} className="text-text-muted" />
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="border-border/70 bg-bg-input/35 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">
            {t('project.overview.outputTitle', { defaultValue: 'Output' })}
          </p>
          {outputText ? (
            <p className="mt-2 text-sm font-medium text-text-heading">{outputText}</p>
          ) : (
            <Badge className="mt-3 w-fit" variant="success">
              {defaultOutputLabel}
            </Badge>
          )}
        </Card>
      </div>
    </ProjectShell>
  )
}
