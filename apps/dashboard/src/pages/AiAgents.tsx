import { useCallback, useEffect, useMemo, useState } from 'react'
import { agentStatusOf, presenceLabel, presenceTextClass } from '../lib/presence'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bot, CalendarDays, Inbox, MessageSquare, Plus, RefreshCw, Search } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { AiAvatar } from '../components/ui/AiAvatar'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { EmptyState } from '../components/ui/empty-state'
import { PageContent } from '../components/layout/PageContent'
import ContentHeader from '../components/shell/ContentHeader'
import { PageRelatedLinks } from '../components/layout/PageRelatedLinks'
import { NewAgentDialog } from '../components/workforce/NewAgentDialog'
import { AgentActivityTimeline } from '../components/workforce/AgentActivityTimeline'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { listAgents } from '../lib/agents-api'
import { formatAgentModelLine } from '../lib/model-label'
import { activityTerminalPath, agentChatPath, forYouPath } from '../lib/messages-paths'
import { openEntityPath } from '../lib/open-entity'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import type { RuntimeAgent } from '../lib/workforce-api'
import { filterLibraryAgents, sortAgentsForLibrary } from '../lib/workforce-nav-agents'
import { useAgentLive, seedAgentPresence, withAgentLive } from '../hooks/useAgentPresence'
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
        className="h-7 px-2 text-xs"
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
        className="h-7 px-2 text-xs"
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
        className="h-7 px-2 text-xs"
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

function AgentLibraryCard({
  agent,
  projectName,
}: {
  agent: RuntimeAgent
  projectName?: string
}) {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const live = useAgentLive(agent.id)
  const view = withAgentLive(agent)
  const work = agentStatusOf(view)
  const href = work === 'working' ? openEntityPath({ type: 'agent', id: agent.id, live }) : `/agents/${agent.id}`
  const openCount = view.open_conversations ?? 0
  const decisionCount = view.awaiting_decision ?? 0
  const summary = view.current_activity_summary

  return (
    <Link to={href} className="block h-full">
      <Card interactive className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <AiAvatar
            name={agent.name}
            seed={agent.id}
            size={36}
            className="mt-0.5"
            kind={agent.avatar_kind}
            icon={agent.avatar_icon}
            imageUrl={agent.avatar_image_url}
            decorative
            activity={
              work === 'working' ? 'working' : work === 'error' ? 'error' : 'standby'
            }
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate-fade font-medium text-text-heading">{agent.name}</p>
              {agent.managed ? (
                <span
                  className="shrink-0 rounded border border-border/70 px-1.5 py-0.5 text-2xs font-medium text-text-muted"
                  title={
                    agent.origin_label
                      ? t('workforce.agents.managedBadgeHint', { origin: agent.origin_label })
                      : t('workforce.agents.managedBadge')
                  }
                >
                  {t('workforce.agents.managedBadgeShort')}
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className={cn('text-xs font-medium', presenceTextClass(work))}>
                {presenceLabel(work, t)}
              </span>
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
                    className="text-xs font-medium text-accent hover:underline"
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
                      navigate(forYouPath(null, { agent: agent.id, needs_decision: '1' }))
                    }}
                    className="text-xs font-medium text-text-heading hover:underline"
                  >
                    {t('workforce.agents.awaitingDecisionCount', { count: decisionCount })}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        {summary ? (
          <p className="line-clamp-2 text-sm text-text-secondary">{summary}</p>
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
              className="truncate-fade text-2xs text-text-muted/80"
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'working'>('all')
  const statusTick = useAgentLive()
  const visibleAgents = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return agents.filter((agent) => {
      const view = withAgentLive(agent)
      if (statusFilter === 'working' && agentStatusOf(view) !== 'working') return false
      if (!needle) return true
      const hay = [view.name, view.purpose, view.current_activity_summary]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(needle)
    })
  }, [agents, query, statusFilter, statusTick])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [rows, projectRows] = await Promise.all([listAgents(), listProjects()])
      const library = sortAgentsForLibrary(filterLibraryAgents(rows))
      seedAgentPresence(library)
      setAgents(library)
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
      footer={
        <Link to="/docs/ai/agents" className="text-xs font-medium text-accent hover:underline">
          {t('pageGuides.learnMore')}
        </Link>
      }
    />
  )

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      <ContentHeader
        guide="agents"
        title={t('workforce.agents.title')}
        subtitle={t('workforce.agents.listDescription')}
        className="mb-0"
        meta={
          <>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => void load()}
              disabled={loading}
              title={t('workforce.agents.refresh')}
              aria-label={t('workforce.agents.refresh')}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            </Button>
            {isAdmin ? (
              <Button type="button" size="sm" onClick={() => setShowNewAgent(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {t('workforce.agents.newAgent')}
              </Button>
            ) : null}
          </>
        }
      />

      {agents.length > 0 ? (
        <AgentActivityTimeline
          agents={agents.map((agent) => ({ id: agent.id, name: agent.name }))}
        />
      ) : null}

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
          {(['all', 'working'] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setStatusFilter(id)}
              className={
                statusFilter === id
                  ? 'rounded-md bg-bg-hover px-2 py-0.5 text-xs font-medium text-text-heading'
                  : 'rounded-md border border-border/70 px-2 py-0.5 text-xs text-text-secondary hover:bg-bg-hover/60 hover:text-text-heading'
              }
            >
              {t(`workforce.agents.filters.${id}`)}
            </button>
          ))}
        </div>
      ) : null}

      <p className="text-xs text-text-muted">{t('workforce.agents.routingBody')}</p>

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
              <Button size="sm" onClick={() => setShowNewAgent(true)}>
                <Plus className="mr-1 h-4 w-4" aria-hidden />
                {t('workforce.agents.newAgent')}
              </Button>
            }
            footer={
              <Link to="/docs/ai/agents" className="text-xs font-medium text-accent hover:underline">
                {t('pageGuides.learnMore')}
              </Link>
            }
          />
        ) : (
          askAdminEmpty
        )
      ) : (
        visibleAgents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 px-4 py-8 text-center">
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

      <PageRelatedLinks
        links={[
          ...(isAdmin
            ? [
                { to: '/projects', label: t('workforce.agents.projectsLink') },
                { to: '/settings/communication', label: t('workforce.agents.relatedInboxAi') },
              ]
            : []),
        ]}
      />
    </PageContent>
  )
}
