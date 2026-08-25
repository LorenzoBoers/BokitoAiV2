import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bot, CalendarDays, MessageSquare, Plus, RefreshCw } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { AiAvatar } from '../components/ui/AiAvatar'
import { LoadingBlock } from '../components/ui/loading-block'
import { EmptyState } from '../components/ui/empty-state'
import { PageContent } from '../components/layout/PageContent'
import { PageGuideBanner } from '../components/layout/PageGuideBanner'
import { NewAgentDialog } from '../components/workforce/NewAgentDialog'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { listAgents } from '../lib/agents-api'
import { agentChatPath, inboxPath } from '../lib/messages-paths'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import type { RuntimeAgent } from '../lib/workforce-api'
import {
  agentType,
  filterOrchestratorAgents,
  filterUserAgents,
  sortAgentsByUpdated,
} from '../lib/workforce-nav-agents'
import { cn } from '../lib/utils'

function AgentQuickLinks({
  agentId,
  chatLabel,
  scheduleLabel,
}: {
  agentId: string
  chatLabel: string
  scheduleLabel: string
}) {
  const navigate = useNavigate()
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-[11px]"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          navigate(agentChatPath(agentId))
        }}
      >
        <MessageSquare size={12} className="mr-1" />
        {chatLabel}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-[11px]"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          navigate(`/agenda?agent=${encodeURIComponent(agentId)}`)
        }}
      >
        <CalendarDays size={12} className="mr-1" />
        {scheduleLabel}
      </Button>
    </span>
  )
}

const STATUS_CLASS: Record<RuntimeAgent['status'], string> = {
  active: 'text-status-success',
  standby: 'text-text-muted',
  sleeping: 'text-text-muted',
  error: 'text-status-error',
}

export default function AiAgents() {
  const { t } = useTranslation(['nav', 'common'])
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const [poAgents, setPoAgents] = useState<RuntimeAgent[]>([])
  const [workerAgents, setWorkerAgents] = useState<RuntimeAgent[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNewAgent, setShowNewAgent] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [rows, projectRows] = await Promise.all([listAgents(), listProjects()])
      setPoAgents(sortAgentsByUpdated(filterOrchestratorAgents(rows)))
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

  const askAdminEmpty = (
    <EmptyState
      icon={Bot}
      title={t('workforce.agents.askAdmin')}
      description={t('workforce.agents.askAdminHint')}
      action={
        <Button size="sm" asChild>
          <Link to={inboxPath('all')}>{t('workforce.agents.openCommunication')}</Link>
        </Button>
      }
    />
  )

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      <PageGuideBanner page="agents" />
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-heading">{t('workforce.agents.title')}</h1>
          <p className="text-sm text-text-muted mt-1">{t('workforce.agents.listDescription')}</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin ? (
            <Button type="button" size="sm" variant="ghost" asChild>
              <Link to="/projects">{t('workforce.agents.projectsLink')}</Link>
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            {t('workforce.agents.refresh')}
          </Button>
          {isAdmin ? (
            <Button type="button" size="sm" onClick={() => setShowNewAgent(true)}>
              <Plus className="mr-1 h-4 w-4" aria-hidden />
              {t('workforce.agents.newAgent')}
            </Button>
          ) : null}
        </div>
      </header>

      {loading ? (
        <LoadingBlock label={t('workforce.agents.loading')} />
      ) : error ? (
        isAdmin ? (
          <Card className="p-4">
            <p className="text-sm text-status-error">{error}</p>
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => void load()}>
              {t('common:actions.retry')}
            </Button>
          </Card>
        ) : (
          askAdminEmpty
        )
      ) : poAgents.length === 0 && workerAgents.length === 0 ? (
        isAdmin ? (
          <EmptyState
            icon={Bot}
            title={t('workforce.agents.empty')}
            description={t('workforce.agents.emptyHint')}
            action={
              <div className="flex flex-col items-center gap-2">
                <Button size="sm" onClick={() => setShowNewAgent(true)}>
                  <Plus className="mr-1 h-4 w-4" aria-hidden />
                  {t('workforce.agents.newAgent')}
                </Button>
                <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs">
                  <Link to="/settings/setup" className="font-medium text-accent hover:underline">
                    {t('settings.links.setupGuide')}
                  </Link>
                  <Link to="/knowledge" className="font-medium text-accent hover:underline">
                    {t('tabs.knowledge.title')}
                  </Link>
                  <Link to="/communication/new" className="font-medium text-accent hover:underline">
                    {t('support.newChat')}
                  </Link>
                </div>
              </div>
            }
          />
        ) : (
          askAdminEmpty
        )
      ) : (
        <Card className="overflow-hidden divide-y divide-border/60">
          <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            {t('workforce.agents.sections.po')}
          </div>
          <ul>
            {poAgents.length === 0 ? (
              <li className="px-4 py-3">
                <p className="text-sm text-text-muted">{t('workforce.po.none')}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {isAdmin ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setShowNewAgent(true)}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
                      {t('workforce.agents.newAgent')}
                    </Button>
                  ) : null}
                  <Link
                    to="/projects"
                    className="text-[12px] font-medium text-accent hover:underline"
                  >
                    {t('workforce.po.openProjects')}
                  </Link>
                </div>
              </li>
            ) : (
              poAgents.map((agent) => (
                <li key={agent.id}>
                  <Link
                    to={`/agents/${agent.id}`}
                    className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-bg-hover/50"
                  >
                    <div className="flex min-w-0 items-start gap-2.5">
                      <AiAvatar name={agent.name} seed={agent.id} size={28} className="mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-medium text-text-heading">{agent.name}</p>
                        <div className="mt-0.5 flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {t(`workforce.agents.types.${agentType(agent)}`)}
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
                              {t('workforce.agents.projectLink', { name: linkedProject.name })}
                            </p>
                          )
                        })()}
                      </div>
                    </div>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <AgentQuickLinks
                        agentId={agent.id}
                        chatLabel={t('workforce.agents.chat')}
                        scheduleLabel={t('workforce.agents.schedule')}
                      />
                      <span className={cn('text-xs font-medium capitalize', STATUS_CLASS[agent.status])}>
                        {t(`workforce.agents.status.${agent.status}`)}
                      </span>
                      {agent.model ? (
                        <span className="rounded-full border border-border/60 bg-bg-elevated/60 px-2 py-0.5 text-[10px] text-text-muted">
                          {agent.model}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
          <div className="border-y border-border/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            {t('workforce.agents.sections.workers')}
          </div>
          <ul>
            {workerAgents.length === 0 ? (
              <li className="px-4 py-3 text-sm text-text-muted">
                {t('workforce.agents.workersEmpty')}
              </li>
            ) : (
              workerAgents.map((agent) => (
                <li key={agent.id}>
                  <Link
                    to={`/agents/${agent.id}`}
                    className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-bg-hover/50"
                  >
                    <div className="flex min-w-0 items-start gap-2.5">
                      <AiAvatar name={agent.name} seed={agent.id} size={28} className="mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-medium text-text-heading">{agent.name}</p>
                        <div className="mt-0.5 flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {t(`workforce.agents.types.${agentType(agent)}`)}
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
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <AgentQuickLinks
                        agentId={agent.id}
                        chatLabel={t('workforce.agents.chat')}
                        scheduleLabel={t('workforce.agents.schedule')}
                      />
                      <span className={cn('text-xs font-medium capitalize', STATUS_CLASS[agent.status])}>
                        {t(`workforce.agents.status.${agent.status}`)}
                      </span>
                      {agent.model ? (
                        <span className="rounded-full border border-border/60 bg-bg-elevated/60 px-2 py-0.5 text-[10px] text-text-muted">
                          {agent.model}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
        </Card>
      )}

      <NewAgentDialog
        open={showNewAgent}
        onOpenChange={setShowNewAgent}
        onCreated={(agentId) => navigate(`/agents/${agentId}`)}
      />
    </PageContent>
  )
}
