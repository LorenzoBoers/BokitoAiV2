import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Bot, GripHorizontal, Plus, Settings2, Sparkles, Workflow } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Card } from '../components/ui/card'
import { LoadingBlock } from '../components/ui/loading-block'
import { EmptyState } from '../components/ui/empty-state'
import { AiAvatar } from '../components/ui/AiAvatar'
import { ProjectShell } from '../components/project/ProjectShell'
import { useProjectContext } from '../context/ProjectContext'
import { useProjectHubNav } from '../context/ProjectHubNavContext'
import { formatWorkerStatusLabel } from '../lib/project-worker-status'
import { useConnectedIntegrationsSummary } from '../hooks/useConnectedIntegrationsSummary'
import type { ProjectWorkstreamRow, WorkstreamStep } from '../lib/workstreams-api'
import { cn } from '../lib/utils'

function streamStatusVariant(status: ProjectWorkstreamRow['status']): 'secondary' | 'success' | 'warning' {
  if (status === 'active') return 'success'
  if (status === 'paused') return 'warning'
  return 'secondary'
}

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
  const { t, i18n } = useTranslation('nav')
  const { projectId } = useProjectContext()
  const {
    getWorkerStatus,
    statusLoading,
    workstreams,
    poAgent,
    workstreamsLoading,
    workstreamsError,
    refreshWorkstreams,
    setSelectedProjectId,
  } = useProjectHubNav()
  const integrations = useConnectedIntegrationsSummary()
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    if (projectId) setSelectedProjectId(projectId)
  }, [projectId, setSelectedProjectId])

  useEffect(() => {
    if (projectId) void refreshWorkstreams()
  }, [projectId, refreshWorkstreams])

  const selectedStreamSlug = searchParams.get('stream') ?? workstreams[0]?.slug ?? null
  const selectedStream =
    workstreams.find((stream) => stream.slug === selectedStreamSlug) ?? workstreams[0] ?? null

  const projectStatus = getWorkerStatus(projectId)
  const statusText = projectStatus
    ? formatWorkerStatusLabel(projectStatus, t, i18n.language)
    : statusLoading
      ? t('backgroundWorkers.status.loading')
      : t('backgroundWorkers.status.idle')

  const availableTools = useMemo(() => {
    const tools: Array<{ key: string; label: string }> = []
    if (integrations.github.length > 0) tools.push({ key: 'github', label: 'GitHub' })
    if (integrations.emailOutlook > 0) tools.push({ key: 'outlook', label: 'Outlook' })
    if (integrations.emailGmail > 0) tools.push({ key: 'gmail', label: 'Gmail' })
    if (integrations.mcpRows.length > 0) {
      tools.push({ key: 'mcp', label: integrations.mcpRows[0]?.providerName ?? 'MCP' })
    }
    if (tools.length === 0) {
      return [
        { key: 'github', label: 'GitHub (mock)' },
        { key: 'outlook', label: 'Outlook (mock)' },
        { key: 'mcp', label: 'MCP (mock)' },
      ]
    }
    return tools
  }, [integrations.emailGmail, integrations.emailOutlook, integrations.github.length, integrations.mcpRows])

  const toolByKey = useMemo(
    () => new Map(availableTools.map((tool) => [tool.key, tool.label])),
    [availableTools],
  )

  const steps = selectedStream ? normalizeSteps(selectedStream) : []

  function selectStream(streamSlug: string) {
    const next = new URLSearchParams(searchParams)
    next.set('stream', streamSlug)
    setSearchParams(next, { replace: true })
  }

  if (workstreamsLoading && workstreams.length === 0) {
    return (
      <ProjectShell width="wide">
        <LoadingBlock label={t('backgroundWorkers.loading')} />
      </ProjectShell>
    )
  }

  if (workstreamsError && workstreams.length === 0) {
    return (
      <ProjectShell width="wide">
        <Card className="p-4">
          <p className="text-sm text-status-error">{workstreamsError}</p>
        </Card>
      </ProjectShell>
    )
  }

  if (!selectedStream) {
    return (
      <ProjectShell width="wide">
        <EmptyState
          title={t('backgroundWorkers.emptyTitle', { defaultValue: 'No workstreams yet' })}
          description={t('backgroundWorkers.emptyDescription')}
        />
      </ProjectShell>
    )
  }

  return (
    <ProjectShell width="wide">
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="h-fit border-border/70 bg-bg-surface/95 p-3">
          <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            {t('project.overview.streamsLabel', { defaultValue: 'Workstreams' })}
          </p>
          <div className="mt-2 space-y-1">
            {workstreams.map((stream) => {
              const active = stream.slug === selectedStream.slug
              return (
                <button
                  key={stream.id}
                  type="button"
                  onClick={() => selectStream(stream.slug)}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-left transition-all',
                    active
                      ? 'border-border/70 bg-bg-hover/80'
                      : 'border-transparent hover:border-border/60 hover:bg-bg-hover/45',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-text-heading">{stream.name}</span>
                    <Badge variant={streamStatusVariant(stream.status)} className="text-[10px] capitalize">
                      {stream.status}
                    </Badge>
                  </div>
                  {stream.trigger_text ? (
                    <p className="mt-1 truncate text-xs text-text-muted">{stream.trigger_text}</p>
                  ) : null}
                </button>
              )
            })}
          </div>
          <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
            <Button size="sm" variant="secondary" className="w-full justify-start" disabled>
              <Plus size={14} className="mr-1.5" />
              {t('project.overview.addStream', { defaultValue: 'Add workstream' })}
            </Button>
            <Button size="sm" variant="ghost" className="w-full justify-start" asChild>
              <Link to={`/project/${projectId}/communication?stream=${selectedStream.slug}`}>
                {t('project.overview.openStreamCommunication', { defaultValue: 'Open stream communication' })}
              </Link>
            </Button>
            <Button size="sm" variant="ghost" className="w-full justify-start" asChild>
              <Link to={`/project/${projectId}/communication`}>
                {t('project.overview.openProjectCommunication', { defaultValue: 'Open project communication' })}
              </Link>
            </Button>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="border-border/80 bg-bg-surface/95 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Workflow size={16} className="text-text-muted" />
                  <p className="text-sm font-semibold text-text-heading">{selectedStream.name}</p>
                  <Badge variant="secondary" className="text-[11px] capitalize">
                    {selectedStream.status}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-text-muted">{t('project.overview.description')}</p>
                <p className="mt-2 text-xs text-text-muted">{statusText}</p>
                <div className="mt-3 rounded-lg border border-border/60 bg-bg-input/30 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                    {t('projectHub.po.label', { defaultValue: 'Project PO' })}
                  </p>
                  {poAgent ? (
                    <Link
                      to={`/ai/agents/${poAgent.id}`}
                      className="mt-1.5 flex items-center gap-2 transition-colors hover:text-accent"
                    >
                      <AiAvatar name={poAgent.name} seed={poAgent.id} size={24} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-text-heading">{poAgent.name}</span>
                        <span className="mt-0.5 flex items-center gap-1.5">
                          <Badge variant="secondary" className="text-[10px]">
                            {t('workforce.agents.types.po', { defaultValue: 'PO' })}
                          </Badge>
                          {poAgent.status ? (
                            <span className="text-xs capitalize text-text-muted">{poAgent.status}</span>
                          ) : null}
                        </span>
                      </span>
                    </Link>
                  ) : (
                    <p className="mt-1 text-xs text-text-muted">
                      {t('projectHub.po.none', { defaultValue: 'No PO agent linked to this project yet.' })}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
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
            </div>
          </Card>

          <div className="grid gap-3 xl:grid-cols-[220px_minmax(0,1fr)_220px]">
            <Card className="border-border/70 bg-bg-input/35 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">
                {t('project.overview.inputTitle', { defaultValue: 'Input' })}
              </p>
              <p className="mt-2 text-sm font-medium text-text-heading">
                {selectedStream.trigger_text || t('project.overview.inputChip')}
              </p>
              <Badge className="mt-3 w-fit" variant="info">
                {t('project.overview.inputChip', { defaultValue: 'in: project context + PO trigger' })}
              </Badge>
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
                                {toolByKey.get(toolKey) ??
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
              <p className="mt-2 text-sm font-medium text-text-heading">
                {selectedStream.output_text || t('project.overview.outputChip')}
              </p>
              <Badge className="mt-3 w-fit" variant="success">
                {t('project.overview.outputChip', { defaultValue: 'out: stream report to PO' })}
              </Badge>
            </Card>
          </div>
        </div>
      </div>
    </ProjectShell>
  )
}
