import { useCallback, useEffect, useMemo, useState } from 'react'
import { agentStatusOf, presenceLabel, presenceTextClass } from '../lib/presence'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bot, CalendarDays, Inbox, MessageSquare, Plus, RefreshCw } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { AiAvatar } from '../components/ui/AiAvatar'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { EmptyState } from '../components/ui/empty-state'
import { SearchField } from '../components/ui/search-field'
import { SegmentedControl } from '../components/ui/segmented-control'
import { PageContent } from '../components/layout/PageContent'
import ContentHeader from '../components/shell/ContentHeader'
import { PageRelatedLinks } from '../components/layout/PageRelatedLinks'
import { NewAgentDialog } from '../components/workforce/NewAgentDialog'
import { AgentActivityTimeline } from '../components/workforce/AgentActivityTimeline'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { listAgents } from '../lib/agents-api'
import { formatAgentModelLine } from '../lib/model-label'
import { activityTerminalPath, agentChatPath, forYouPath } from '../lib/messages-paths'
import { withNavReveal } from '../lib/nav-reveal'
import { openEntityPath } from '../lib/open-entity'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import type { RuntimeAgent } from '../lib/workforce-api'
import {
  filterLibraryAgents,
  isDeactivatedAgent,
  sortAgentsForLibrary,
} from '../lib/workforce-nav-agents'
import { useAgentLive, seedAgentPresence, withAgentLive } from '../hooks/useAgentPresence'
import { AgentActiveLine } from '../components/inbox/IdentitySeenLine'
import { cn } from '../lib/utils'

type AgentStatusFilter = 'all' | 'working' | 'deactivated'

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
  const actions = [
    { label: chatLabel, icon: MessageSquare, go: () => navigate(withNavReveal(agentChatPath(agentId))) },
    { label: runsLabel, icon: Inbox, go: () => navigate(activityTerminalPath(agentId)) },
    {
      label: scheduleLabel,
      icon: CalendarDays,
      go: () => navigate(`/agenda?agent=${encodeURIComponent(agentId)}`),
    },
  ] as const
  return (
    <span className="flex items-center gap-0.5">
      {actions.map(({ label, icon: Icon, go }) => (
        <Button
          key={label}
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs text-text-secondary hover:text-text-heading"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            go()
          }}
        >
          <Icon size={12} aria-hidden />
          {label}
        </Button>
      ))}
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
    <Link to={href} className="group block h-full">
      <Card
        interactive
        className="flex h-full flex-col gap-3 border-border/50 p-4 transition-[border-color,box-shadow] duration-150 group-hover:border-ai/25"
      >
        <div className="flex items-start gap-3">
          <AiAvatar
            name={agent.name}
            seed={agent.id}
            size={40}
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
              <p className="truncate-fade text-lg font-semibold tracking-tight text-text-heading">
                {agent.name}
              </p>
              {agent.managed ? (
                <span
                  className="shrink-0 rounded-md bg-bg-hover/80 px-1.5 py-0.5 text-2xs font-medium text-text-muted"
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
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {isDeactivatedAgent(agent) ? (
                <span className="inline-flex items-center rounded-md bg-status-error/10 px-1.5 py-0.5 text-2xs font-medium text-status-error">
                  {presenceLabel('deactivated', t)}
                </span>
              ) : (
                <span
                  className={cn(
                    'inline-flex items-center rounded-md px-1.5 py-0.5 text-2xs font-medium',
                    work === 'working' && 'bg-ai/12',
                    work === 'error' && 'bg-status-error/10',
                    work === 'standby' && 'bg-bg-hover/80',
                    presenceTextClass(work),
                  )}
                >
                  {presenceLabel(work, t)}
                </span>
              )}
              {projectName ? (
                <span className="truncate text-2xs text-text-muted">
                  {t('workforce.agents.projectLink', { name: projectName })}
                </span>
              ) : null}
            </div>
            {!isDeactivatedAgent(agent) ? (
              <AgentActiveLine at={view.last_active_at} working={work === 'working'} />
            ) : null}
            {agent.description ? (
              <p className="mt-2 line-clamp-2 text-sm leading-snug text-text-secondary">{agent.description}</p>
            ) : null}
            {openCount > 0 || decisionCount > 0 ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
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
        {summary && work === 'working' ? (
          <p className="line-clamp-2 text-sm leading-snug text-text-muted">{summary}</p>
        ) : !agent.description && summary ? (
          <p className="line-clamp-2 text-sm leading-snug text-text-secondary">{summary}</p>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/40 pt-2.5">
          <AgentQuickLinks
            agentId={agent.id}
            chatLabel={t('workforce.agents.chat')}
            scheduleLabel={t('workforce.agents.schedule')}
            runsLabel={t('workforce.agents.runs')}
          />
          {agent.model ? (
            <span
              title={agent.model}
              className="truncate-fade text-2xs text-text-muted/70"
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
  const [statusFilter, setStatusFilter] = useState<AgentStatusFilter>('all')
  const statusTick = useAgentLive()
  const visibleAgents = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return agents.filter((agent) => {
      const view = withAgentLive(agent)
      const deactivated = isDeactivatedAgent(agent)
      if (statusFilter === 'deactivated') {
        if (!deactivated) return false
      } else if (deactivated) {
        return false
      } else if (statusFilter === 'working' && agentStatusOf(view) !== 'working') {
        return false
      }
      if (!needle) return true
      const hay = [view.name, view.description, view.purpose, view.current_activity_summary]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(needle)
    })
  }, [agents, query, statusFilter, statusTick])

  const deactivatedCount = useMemo(
    () => agents.filter(isDeactivatedAgent).length,
    [agents],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [rows, projectRows] = await Promise.all([
        listAgents({ includeInactive: true }),
        listProjects(),
      ])
      const library = sortAgentsForLibrary(filterLibraryAgents(rows, { includeInactive: true }))
      seedAgentPresence(library.filter((a) => !isDeactivatedAgent(a)))
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
    <PageContent width="xl" className="space-y-5 py-1">
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

      {agents.some((a) => !isDeactivatedAgent(a)) ? (
        <AgentActivityTimeline
          agents={agents
            .filter((agent) => !isDeactivatedAgent(agent))
            .map((agent) => ({
              id: agent.id,
              name: agent.name,
              avatar_kind: agent.avatar_kind,
              avatar_icon: agent.avatar_icon,
              avatar_image_url: agent.avatar_image_url,
            }))}
        />
      ) : null}

      {agents.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={t('workforce.agents.searchPlaceholder')}
            aria-label={t('workforce.agents.searchPlaceholder')}
            className="min-w-[14rem] max-w-sm flex-1"
          />
          <SegmentedControl
            value={statusFilter}
            onChange={setStatusFilter}
            options={(['all', 'working', 'deactivated'] as const).map((id) => ({
              value: id,
              label: `${t(`workforce.agents.filters.${id}`)}${
                id === 'deactivated' && deactivatedCount > 0 ? ` (${deactivatedCount})` : ''
              }`,
            }))}
          />
        </div>
      ) : null}

      <p className="text-xs leading-relaxed text-text-muted/90">{t('workforce.agents.routingBody')}</p>

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
      ) : agents.filter((a) => !isDeactivatedAgent(a)).length === 0 &&
        statusFilter !== 'deactivated' ? (
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
            <p className="text-sm text-text-muted">
              {statusFilter === 'deactivated'
                ? t('workforce.agents.emptyDeactivated')
                : t('workforce.agents.emptySearch')}
            </p>
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
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
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
          { to: '/team', label: t('workforce.agents.relatedWorkforce') },
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
