import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LiveWorkLog } from '../components/observability/LiveWorkLog'
import { WorkLogsTable } from '../components/workforce/WorkLogsTable'
import { Card } from '../components/ui/card'
import { LoadingBlock } from '../components/ui/loading-block'
import { EmptyState } from '../components/ui/empty-state'
import { PageContent } from '../components/layout/PageContent'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { listAgents } from '../lib/agents-api'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import { listWorkLogs, type WorkLogRow } from '../lib/work-logs-api'
import { agentWorkforceRunUrl } from '../lib/workforce-run-urls'
import type { RuntimeAgent } from '../lib/workforce-api'
import { WORKFORCE_DEFAULT_PATH, projectOrchestratorPath } from '../components/layout/portal-nav'
import { AiAvatar } from '../components/ui/AiAvatar'
import { cn } from '../lib/utils'
import { isPoAgent } from '../lib/workforce-nav-agents'

const STATUS_CLASS: Record<RuntimeAgent['status'], string> = {
  active: 'text-status-success',
  standby: 'text-text-muted',
  sleeping: 'text-text-muted',
  error: 'text-status-error',
}

export default function AiAgentDetail() {
  const { t } = useTranslation('nav')
  const { agentId, workLogId } = useParams<{ agentId: string; workLogId?: string }>()
  const isAdmin = useIsAdmin()
  const [agent, setAgent] = useState<RuntimeAgent | null>(null)
  const [runs, setRuns] = useState<WorkLogRow[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!agentId || workLogId) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const [agentRows, projectRows] = await Promise.all([listAgents(), listProjects()])
        let runRows: WorkLogRow[] = []
        try {
          runRows = await listWorkLogs({ agent_id: agentId, limit: 50 })
        } catch {
          const all = await listWorkLogs({ limit: 100 })
          runRows = all.filter((r) => r.agent_id === agentId)
        }
        if (runRows.length === 0) {
          const all = await listWorkLogs({ limit: 100 })
          runRows = all.filter((r) => r.agent_id === agentId)
        }
        if (cancelled) return
        setAgent(agentRows.find((a) => a.id === agentId) ?? null)
        setRuns(runRows)
        setProjects(projectRows)
      } catch (e) {
        if (!cancelled) {
          setAgent(null)
          setRuns([])
          setError(e instanceof Error ? e.message : t('ai.agents.detailLoadError'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [agentId, workLogId, t])

  const runTo = useMemo(
    () => (run: WorkLogRow) => agentWorkforceRunUrl(agentId ?? '', run.id),
    [agentId],
  )
  const linkedProject = useMemo(() => {
    if (!agent) return null
    return projects.find((project) => project.po_agent_id === agent.id) ?? null
  }, [agent, projects])

  if (!isAdmin) {
    return <Navigate to="/messages" replace />
  }

  if (!agentId) {
    return <Navigate to={WORKFORCE_DEFAULT_PATH} replace />
  }

  if (workLogId) {
    return (
      <PageContent width="xl" className="space-y-4 py-1">
        <Link
          to={`/ai/agents/${agentId}`}
          className="text-sm text-accent hover:underline"
        >
          {t('ai.agents.backToAgent')}
        </Link>
        <LiveWorkLog workLogId={workLogId} />
      </PageContent>
    )
  }

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      <Link to={WORKFORCE_DEFAULT_PATH} className="text-sm text-accent hover:underline">
        {t('workforce.agents.backToList')}
      </Link>

      {loading ? (
        <LoadingBlock label={t('ai.agents.loading')} />
      ) : !agent ? (
        <Card className="p-4">
          <p className="text-sm text-status-error">
            {error ?? t('ai.agents.notFound')}
          </p>
        </Card>
      ) : (
        <>
          <Card className="px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <AiAvatar name={agent.name} seed={agent.id} size={34} className="mt-0.5" />
                <div>
                  <h2 className="text-lg font-semibold text-text-heading">{agent.name}</h2>
                  <p className="mt-0.5 text-sm text-text-muted">
                    {agent.role_name || agent.role_slug || t('ai.agents.roleUnknown')}
                  </p>
                </div>
              </div>
              <span
                className={cn('text-sm font-medium capitalize', STATUS_CLASS[agent.status])}
              >
                {t(`ai.agents.status.${agent.status}`, { defaultValue: agent.status })}
              </span>
            </div>
            {agent.current_activity_summary ? (
              <p className="mt-2 text-sm text-text-secondary">{agent.current_activity_summary}</p>
            ) : null}
            {isPoAgent(agent) && linkedProject ? (
              <div className="mt-3 rounded-lg border border-border/60 bg-bg-input/35 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                  {t('project.po.title', { defaultValue: 'Orchestrator' })}
                </p>
                <Link
                  to={projectOrchestratorPath(linkedProject.id)}
                  className="mt-1 block text-sm font-medium text-accent hover:underline"
                >
                  {linkedProject.name}
                </Link>
              </div>
            ) : null}
          </Card>

          <div className="space-y-2">
            <h3 className="text-base font-semibold text-text-heading">
              {t('workforce.agents.historyTitle')}
            </h3>
            <p className="text-sm text-text-muted">{t('workforce.agents.historyDescription')}</p>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {runs.length === 0 ? (
              <EmptyState title={t('workforce.runs.empty')} />
            ) : (
              <WorkLogsTable
                runs={runs}
                projects={projects}
                runTo={runTo}
                showProjectColumn
              />
            )}
          </div>
        </>
      )}
    </PageContent>
  )
}
