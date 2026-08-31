import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bot, CalendarDays, Inbox, MessageSquare, Plus, RefreshCw, Search } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { AiAvatar } from '../components/ui/AiAvatar'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { EmptyState } from '../components/ui/empty-state'
import { PageContent } from '../components/layout/PageContent'
import { PageGuideBanner } from '../components/layout/PageGuideBanner'
import { NewAgentDialog } from '../components/workforce/NewAgentDialog'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { listAgents } from '../lib/agents-api'
import { agentRoleLabel } from '../lib/agent-role-label'
import { formatAgentModelLine } from '../lib/model-label'
import { activityTerminalPath, agentChatPath, decisionsPath, inboxPath } from '../lib/messages-paths'
import { talkToAssistantPath } from '../lib/talk-to-assistant'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import type { RuntimeAgent } from '../lib/workforce-api'
import { filterLibraryAgents, sortAgentsForLibrary } from '../lib/workforce-nav-agents'
import { agentStatusI18nKey, agentWorkState } from '../lib/agent-status'
import { cn } from '../lib/utils'

function AgentQuickLinks({
  agentId,
  chatLabel,
  scheduleLabel,
  runsLabel,
}: {
  agentId: string
  chatLabel: string
  scheduleLabel: string
  runsLabel: string
}) {
  const navigate = useNavigate()
  return (
    <span className="flex items-center gap-1">
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
          navigate(activityTerminalPath(agentId))
        }}
      >
        <Inbox size={12} className="mr-1" />
        {runsLabel}
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

const STATUS_CLASS: Record<ReturnType<typeof agentWorkState>, string> = {
  working: 'text-status-success',
  ready: 'text-text-muted',
  paused: 'text-text-muted',
  error: 'text-status-error',
}

function AgentLibraryCard({
  agent,
  projectName,
}: {
  agent: RuntimeAgent
  projectName?: string
}) {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const roleLabel = agentRoleLabel(agent.role_name || agent.role_slug, t)
  const genericRole = new Set([
    t('workforce.agents.types.orchestrator').trim().toLowerCase(),
    t('workforce.agents.types.po').trim().toLowerCase(),
    t('workforce.agents.types.worker').trim().toLowerCase(),
  ])
  const nameLower = (agent.name ?? '').trim().toLowerCase()
  const roleLower = roleLabel.trim().toLowerCase()
  const showRole =
    roleLabel.trim().length > 0 &&
    roleLower !== nameLower &&
    !nameLower.includes(roleLower) &&
    !genericRole.has(roleLower)
  const openCount = agent.open_conversations ?? 0
  const decisionCount = agent.awaiting_decision ?? 0

  return (
    <Link to={`/agents/${agent.id}`} className="block h-full">
      <Card interactive className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <AiAvatar
            name={agent.name}
            seed={agent.id}
            size={36}
            className="mt-0.5"
            kind={agent.avatar_kind}
            icon={agent.avatar_icon}
            color={agent.avatar_color}
            imageUrl={agent.avatar_image_url}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate font-medium text-text-heading">{agent.name}</p>
              {agent.is_lead ? (
                <Badge
                  variant="accent"
                  className="shrink-0 text-[10px]"
                  title={t('workforce.agents.leadHint')}
                >
                  {t('workforce.agents.leadBadgeShort')}
                </Badge>
              ) : null}
            </div>
            {agent.is_lead ? (
              <p className="mt-1 text-[11px] leading-snug text-text-muted">{t('workforce.agents.leadHint')}</p>
            ) : null}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className={cn('text-xs font-medium', STATUS_CLASS[agentWorkState(agent)])}>
                {t(agentStatusI18nKey(agentWorkState(agent)))}
              </span>
              {showRole ? <span className="text-xs text-text-muted">{roleLabel}</span> : null}
            </div>
            {openCount > 0 || decisionCount > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                {openCount > 0 ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      navigate(`/agents/${agent.id}#conversations`)
                    }}
                    className="text-[11px] font-medium text-accent hover:underline"
                  >
                    {t('workforce.agents.openConversationsCount', { count: openCount })}
                  </button>
                ) : null}
                {decisionCount > 0 ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      navigate(`${decisionsPath()}?agent=${encodeURIComponent(agent.id)}`)
                    }}
                    className="text-[11px] font-medium text-text-heading hover:underline"
                  >
                    {t('workforce.agents.awaitingDecisionCount', { count: decisionCount })}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        {agent.current_activity_summary ? (
          <p className="line-clamp-2 text-sm text-text-secondary">{agent.current_activity_summary}</p>
        ) : null}
        {projectName ? (
          <p className="text-xs text-text-muted">{t('workforce.agents.projectLink', { name: projectName })}</p>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-2">
          <AgentQuickLinks
            agentId={agent.id}
            chatLabel={t('workforce.agents.chat')}
            scheduleLabel={t('workforce.agents.schedule')}
            runsLabel={t('workforce.agents.runs')}
          />
          {agent.model ? (
            <span
              title={agent.model}
              className="truncate text-[10px] text-text-muted/80"
            >
              {formatAgentModelLine(agent.model, agent.provider, t)}
            </span>
          ) : null}
        </div>
      </Card>
    </Link>
  )
}

export default function AiAgents() {
  const { t } = useTranslation(['nav', 'common'])
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const [agents, setAgents] = useState<RuntimeAgent[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [showNewAgent, setShowNewAgent] = useState(() => searchParams.get('new') === '1')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'working' | 'paused' | 'lead'>('all')
  const visibleAgents = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return agents.filter((agent) => {
      if (statusFilter === 'lead' && !agent.is_lead) return false
      if (statusFilter === 'working' && agentWorkState(agent) !== 'working') return false
      if (statusFilter === 'paused' && agentWorkState(agent) !== 'paused') return false
      if (!needle) return true
      const hay = [agent.name, agent.role_name, agent.role_slug, agent.current_activity_summary]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(needle)
    })
  }, [agents, query, statusFilter])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [rows, projectRows] = await Promise.all([listAgents(), listProjects()])
      setAgents(sortAgentsForLibrary(filterLibraryAgents(rows)))
      setProjects(projectRows)
    } catch (e) {
      setAgents([])
      setProjects([])
      setError(e instanceof Error ? e.message : t('workforce.agents.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    setShowNewAgent(true)
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const askAdminEmpty = (
    <EmptyState
      icon={Bot}
      title={t('workforce.agents.askAdmin')}
      description={t('workforce.agents.askAdminHint')}
      action={
        <Button size="sm" asChild>
          <Link to={inboxPath('open')}>{t('workforce.agents.openCommunication')}</Link>
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

      {agents.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative max-w-sm flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('workforce.agents.searchPlaceholder')}
              aria-label={t('workforce.agents.searchPlaceholder')}
              className="h-9 w-full rounded-lg border border-border/60 bg-bg-surface pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent/45 focus:outline-none focus:ring-2 focus:ring-accent/15"
            />
          </div>
          {(['all', 'working', 'paused', 'lead'] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setStatusFilter(id)}
              className={
                statusFilter === id
                  ? 'rounded-full bg-accent/15 px-2.5 py-0.5 text-[11px] font-medium text-accent'
                  : 'rounded-full border border-border/60 px-2.5 py-0.5 text-[11px] text-text-secondary hover:text-text-primary'
              }
            >
              {t(`workforce.agents.filters.${id}`)}
            </button>
          ))}
        </div>
      ) : null}

      <div className="rounded-xl border border-border/60 bg-bg-elevated/40 px-4 py-3">
        <p className="text-sm font-medium text-text-heading">{t('workforce.agents.routingTitle')}</p>
        <p className="mt-0.5 text-xs text-text-muted">{t('workforce.agents.routingBody')}</p>
        <Link
          to={talkToAssistantPath(t('workforce.agents.routingAskPrefill'))}
          className="mt-2 inline-block text-xs font-medium text-accent hover:underline"
        >
          {t('workforce.agents.routingAsk')}
        </Link>
      </div>

      {loading ? (
        <CardGridSkeleton />
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
      ) : agents.length === 0 ? (
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
                  <Link to="/agenda" className="font-medium text-accent hover:underline">
                    {t('workforce.agents.openFullAgenda')}
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
        visibleAgents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center">
            <p className="text-sm text-text-muted">{t('workforce.agents.emptySearch')}</p>
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setStatusFilter('all')
              }}
              className="mt-3 text-xs font-medium text-accent hover:underline"
            >
              {t('workforce.agents.clearSearch')}
            </button>
          </div>
        ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleAgents.map((agent) => (
            <AgentLibraryCard
              key={agent.id}
              agent={agent}
              projectName={projects.find((project) => project.po_agent_id === agent.id)?.name}
            />
          ))}
        </div>
        )
      )}

      <NewAgentDialog
        open={showNewAgent}
        onOpenChange={setShowNewAgent}
        onCreated={(agentId) => navigate(`/agents/${agentId}`)}
      />
    </PageContent>
  )
}
