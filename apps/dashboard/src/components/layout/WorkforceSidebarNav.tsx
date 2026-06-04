import { useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { AiAvatar } from '../ui/AiAvatar'
import { listAgents } from '../../lib/agents-api'
import { listProjects, type ProjectRow } from '../../lib/projects-api'
import type { RuntimeAgent } from '../../lib/workforce-api'
import {
  filterPoAgents,
  filterUserAgents,
  sortAgentsByUpdated,
} from '../../lib/workforce-nav-agents'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import NavCountBadge from './NavCountBadge'
import { useNavBadges } from '../../context/NavBadgeContext'
import { countForBadgeSlot } from '../../lib/nav-badge-counts'

const DEFAULT_VISIBLE_COUNT = 6

const STATUS_CLASS: Record<RuntimeAgent['status'], string> = {
  active: 'text-status-success',
  standby: 'text-text-muted',
  sleeping: 'text-text-muted',
  error: 'text-status-error',
}

function rowClass(isActive: boolean) {
  return cn(
    'flex items-start gap-2.5 rounded-lg border px-3 py-2 text-[13px] transition-all',
    isActive
      ? 'border-border/70 bg-bg-hover/85 shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_8px_18px_-14px_rgba(15,23,42,0.4)]'
      : 'border-transparent hover:border-border/60 hover:bg-bg-hover/55',
  )
}

function isAgentDetailActive(pathname: string, agentId: string): boolean {
  const prefix = `/ai/agents/${agentId}`
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

type AgentSectionProps = {
  label: string
  badge?: number
  agents: RuntimeAgent[]
  loading: boolean
  error: string | null
  emptyLabel: string
  loadingLabel: string
  pathname: string
  projects?: ProjectRow[]
  showProjectHint?: boolean
  showAll: boolean
  onShowAllChange: (value: boolean) => void
}

function AgentSection({
  label,
  badge,
  agents,
  loading,
  error,
  emptyLabel,
  loadingLabel,
  pathname,
  projects,
  showProjectHint,
  showAll,
  onShowAllChange,
}: AgentSectionProps) {
  const { t } = useTranslation('nav')

  const hasMore = agents.length > DEFAULT_VISIBLE_COUNT
  const visibleAgents = showAll ? agents : agents.slice(0, DEFAULT_VISIBLE_COUNT)
  const hiddenCount = agents.length - DEFAULT_VISIBLE_COUNT

  return (
    <section className="space-y-1 border-t border-border/40 pt-3">
      <div className="flex items-center gap-2 px-3 pb-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">{label}</p>
        {badge != null && badge > 0 ? <NavCountBadge count={badge} placement="inline" /> : null}
        {agents.length > 0 ? (
          <span className="text-[10px] font-medium text-text-muted">{agents.length}</span>
        ) : null}
      </div>
      <div className="space-y-0.5">
        {loading ? (
          <p className="px-3 py-1 text-xs text-text-muted">{loadingLabel}</p>
        ) : error ? (
          <p className="px-3 py-1 text-xs text-status-error">{error}</p>
        ) : agents.length === 0 ? (
          <p className="px-3 py-1 text-xs text-text-muted">{emptyLabel}</p>
        ) : (
          <>
            {visibleAgents.map((agent) => {
              const to = `/ai/agents/${agent.id}`
              const isActive = isAgentDetailActive(pathname, agent.id)
              const linkedProject =
                showProjectHint && projects
                  ? projects.find((project) => project.po_agent_id === agent.id)
                  : undefined

              return (
                <NavLink key={agent.id} to={to} className={() => rowClass(isActive)}>
                  <AiAvatar name={agent.name} seed={agent.id} size={22} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate font-medium',
                        isActive ? 'text-text-heading' : 'text-text-primary',
                      )}
                      title={agent.name}
                    >
                      {agent.name}
                    </span>
                    <span
                      className={cn(
                        'mt-0.5 block truncate text-xs capitalize',
                        STATUS_CLASS[agent.status],
                      )}
                    >
                      {t(`workforce.agents.status.${agent.status}`, { defaultValue: agent.status })}
                    </span>
                    {linkedProject ? (
                      <span className="mt-0.5 block truncate text-xs text-text-muted">
                        {t('workforce.agents.projectLink', {
                          defaultValue: 'Project: {{name}}',
                          name: linkedProject.name,
                        })}
                      </span>
                    ) : null}
                  </span>
                </NavLink>
              )
            })}
            {hasMore ? (
              <button
                type="button"
                onClick={() => onShowAllChange(!showAll)}
                className="w-full rounded-lg px-3 py-1.5 text-left text-xs font-medium text-text-muted hover:bg-bg-hover/55 hover:text-text-primary"
              >
                {showAll
                  ? t('workforce.agents.sidebar.showLess')
                  : t('workforce.agents.sidebar.showMore', { count: hiddenCount })}
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}

export default function WorkforceSidebarNav() {
  const { t } = useTranslation('nav')
  const { pathname } = useLocation()
  const isAdmin = useIsAdmin()
  const { counts } = useNavBadges()
  const agentsBadge = countForBadgeSlot(counts, 'agents')

  const [agents, setAgents] = useState<RuntimeAgent[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAllPo, setShowAllPo] = useState(false)
  const [showAllWorkers, setShowAllWorkers] = useState(false)

  const poAgents = useMemo(() => sortAgentsByUpdated(filterPoAgents(agents)), [agents])
  const workerAgents = useMemo(() => sortAgentsByUpdated(filterUserAgents(agents)), [agents])

  const activeAgentId = pathname.match(/^\/ai\/agents\/([^/]+)/)?.[1] ?? null
  const poActiveIndex = useMemo(
    () => (activeAgentId ? poAgents.findIndex((a) => a.id === activeAgentId) : -1),
    [activeAgentId, poAgents],
  )
  const workerActiveIndex = useMemo(
    () => (activeAgentId ? workerAgents.findIndex((a) => a.id === activeAgentId) : -1),
    [activeAgentId, workerAgents],
  )

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([listAgents(), listProjects()])
      .then(([agentRows, projectRows]) => {
        if (!cancelled) {
          setAgents(agentRows)
          setProjects(projectRows)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setAgents([])
          setProjects([])
          setError(e instanceof Error ? e.message : t('workforce.agents.loadError'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isAdmin, t])

  useEffect(() => {
    if (poActiveIndex >= DEFAULT_VISIBLE_COUNT) setShowAllPo(true)
  }, [poActiveIndex])

  useEffect(() => {
    if (workerActiveIndex >= DEFAULT_VISIBLE_COUNT) setShowAllWorkers(true)
  }, [workerActiveIndex])

  if (!isAdmin) return null
  if (error && !loading) return null

  return (
    <div className="space-y-3">
      <AgentSection
        label={t('workforce.agents.sections.po', { defaultValue: 'Orchestrators' })}
        agents={poAgents}
        loading={loading}
        error={error}
        emptyLabel={t('workforce.po.none', { defaultValue: 'No orchestrator configured yet.' })}
        loadingLabel={t('workforce.agents.sidebar.loading')}
        pathname={pathname}
        projects={projects}
        showProjectHint
        showAll={showAllPo}
        onShowAllChange={setShowAllPo}
      />
      <AgentSection
        label={t('workforce.agents.sections.workers', { defaultValue: 'Worker agents' })}
        badge={agentsBadge}
        agents={workerAgents}
        loading={loading}
        error={error}
        emptyLabel={t('workforce.agents.empty')}
        loadingLabel={t('workforce.agents.sidebar.loading')}
        pathname={pathname}
        showAll={showAllWorkers}
        onShowAllChange={setShowAllWorkers}
      />
    </div>
  )
}
