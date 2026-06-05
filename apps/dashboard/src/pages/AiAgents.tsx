import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bot } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { AiAvatar } from '../components/ui/AiAvatar'
import { LoadingBlock } from '../components/ui/loading-block'
import { EmptyState } from '../components/ui/empty-state'
import { PageContent } from '../components/layout/PageContent'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { listAgents } from '../lib/agents-api'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import type { RuntimeAgent } from '../lib/workforce-api'
import { agentType, filterPoAgents, filterUserAgents, sortAgentsByUpdated } from '../lib/workforce-nav-agents'
import { cn } from '../lib/utils'

const STATUS_CLASS: Record<RuntimeAgent['status'], string> = {
  active: 'text-status-success',
  standby: 'text-text-muted',
  sleeping: 'text-text-muted',
  error: 'text-status-error',
}

export default function AiAgents() {
  const { t } = useTranslation(['nav', 'common'])
  const isAdmin = useIsAdmin()
  const [poAgents, setPoAgents] = useState<RuntimeAgent[]>([])
  const [workerAgents, setWorkerAgents] = useState<RuntimeAgent[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [rows, projectRows] = await Promise.all([listAgents(), listProjects()])
      setPoAgents(sortAgentsByUpdated(filterPoAgents(rows)))
      setWorkerAgents(sortAgentsByUpdated(filterUserAgents(rows)))
      setProjects(projectRows)
    } catch (e) {
      setPoAgents([])
      setWorkerAgents([])
      setProjects([])
      setError(e instanceof Error ? e.message : t('workforce.agents.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  if (!isAdmin) {
    return <Navigate to="/messages" replace />
  }

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      <header>
        <h1 className="text-2xl font-semibold text-text-heading">{t('workforce.agents.title', { defaultValue: 'Agent library' })}</h1>
        <p className="text-sm text-text-muted mt-1">{t('workforce.agents.listDescription')}</p>
      </header>

      {loading ? (
        <LoadingBlock label={t('workforce.agents.loading')} />
      ) : error ? (
        <Card className="p-4">
          <p className="text-sm text-status-error">{error}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => void load()}>
            {t('common:actions.retry')}
          </Button>
        </Card>
      ) : poAgents.length === 0 && workerAgents.length === 0 ? (
        <EmptyState icon={Bot} title={t('workforce.agents.empty')} />
      ) : (
        <Card className="overflow-hidden divide-y divide-border/60">
          <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            {t('workforce.agents.sections.po', { defaultValue: 'Orchestrators' })}
          </div>
          <ul>
            {poAgents.length === 0 ? (
              <li className="px-4 py-3 text-sm text-text-muted">{t('workforce.po.none')}</li>
            ) : (
              poAgents.map((agent) => (
                <li key={agent.id}>
                  <Link
                    to={`/os/agents/${agent.id}`}
                    className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-bg-hover/50"
                  >
                    <div className="flex min-w-0 items-start gap-2.5">
                      <AiAvatar name={agent.name} seed={agent.id} size={28} className="mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-medium text-text-heading">{agent.name}</p>
                        <div className="mt-0.5 flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {t(`workforce.agents.types.${agentType(agent)}`, { defaultValue: 'Orchestrator' })}
                          </Badge>
                          {(() => {
                            const roleLabel =
                              agent.role_name || agent.role_slug || t('workforce.agents.roleUnknown')
                            const showRole =
                              roleLabel.trim().toLowerCase() !== (agent.name ?? '').trim().toLowerCase()
                            return showRole ? (
                              <p className="text-xs text-text-muted">{roleLabel}</p>
                            ) : null
                          })()}
                        </div>
                        {agent.current_activity_summary ? (
                          <p className="mt-1 line-clamp-2 text-sm text-text-secondary">
                            {agent.current_activity_summary}
                          </p>
                        ) : null}
                        {(() => {
                          const linkedProject = projects.find((project) => project.po_agent_id === agent.id)
                          if (!linkedProject) return null
                          return (
                            <p className="mt-1 text-xs text-text-muted">
                              {t('workforce.agents.projectLink', {
                                defaultValue: 'Project: {{name}}',
                                name: linkedProject.name,
                              })}
                            </p>
                          )
                        })()}
                      </div>
                    </div>
                    <span className={cn('shrink-0 text-xs font-medium capitalize', STATUS_CLASS[agent.status])}>
                      {t(`workforce.agents.status.${agent.status}`, { defaultValue: agent.status })}
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
          <div className="border-y border-border/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            {t('workforce.agents.sections.workers', { defaultValue: 'Worker agents' })}
          </div>
          <ul>
            {workerAgents.length === 0 ? (
              <li className="px-4 py-3 text-sm text-text-muted">
                {t('workforce.agents.workersEmpty', { defaultValue: 'No worker agents yet. They appear when you add assistants or specialists to projects.' })}
              </li>
            ) : (
              workerAgents.map((agent) => (
                <li key={agent.id}>
                  <Link
                    to={`/os/agents/${agent.id}`}
                    className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-bg-hover/50"
                  >
                    <div className="flex min-w-0 items-start gap-2.5">
                      <AiAvatar name={agent.name} seed={agent.id} size={28} className="mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-medium text-text-heading">{agent.name}</p>
                        <div className="mt-0.5 flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {t(`workforce.agents.types.${agentType(agent)}`, { defaultValue: 'Worker' })}
                          </Badge>
                          {(() => {
                            const roleLabel =
                              agent.role_name || agent.role_slug || t('workforce.agents.roleUnknown')
                            const showRole =
                              roleLabel.trim().toLowerCase() !== (agent.name ?? '').trim().toLowerCase()
                            return showRole ? (
                              <p className="text-xs text-text-muted">{roleLabel}</p>
                            ) : null
                          })()}
                        </div>
                        {agent.current_activity_summary ? (
                          <p className="mt-1 line-clamp-2 text-sm text-text-secondary">
                            {agent.current_activity_summary}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <span className={cn('shrink-0 text-xs font-medium capitalize', STATUS_CLASS[agent.status])}>
                      {t(`workforce.agents.status.${agent.status}`, { defaultValue: agent.status })}
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
        </Card>
      )}
    </PageContent>
  )
}
