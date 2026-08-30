import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { Archive, CalendarDays, Copy, Crown, MessageSquare, MoreHorizontal, Network, Pause, Pencil, Play, Settings, ShieldCheck } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { NewAgentDialog } from '../components/workforce/NewAgentDialog'
import { LiveWorkLog } from '../components/observability/LiveWorkLog'
import { WorkLogsTable } from '../components/workforce/WorkLogsTable'
import { AgentChatAccessCard } from '../components/workforce/AgentChatAccessCard'
import { AgentModelCard } from '../components/workforce/AgentModelCard'
import { AgentToolsPicker } from '../components/workforce/AgentToolsPicker'
import { AgentInstructionsCard } from '../components/workforce/AgentInstructionsCard'
import { AgentSignatureCard } from '../components/workforce/AgentSignatureCard'
import { AgentVisualCard } from '../components/workforce/AgentVisualCard'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { EmptyState } from '../components/ui/empty-state'
import { PageContent } from '../components/layout/PageContent'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { listAgents } from '../lib/agents-api'
import { agentAutonomyLevelLabel } from '../lib/labels'
import { agentRoleLabel } from '../lib/agent-role-label'
import { permissionScopeLabel } from '../lib/permission-scope-label'
import { agendaKindLabel } from '../lib/status-labels'
import { translateDecisionText } from '../lib/activity-labels'
import { agentChatPath, agentRunsPath, inboxPath } from '../lib/messages-paths'
import { agendaOccurrenceHref, workLogRunsPath } from '../lib/agenda-thread'
import { formatAppDateTime, formatAppWeekdayDateTime } from '../lib/app-locale'
import { AGENDA_AUTOMATIONS_PATH } from '../lib/navigation'
import { listThreads, type InboxThread } from '../lib/inbox-api'
import { archiveAgent, setLeadAgent, updateAgentStatus } from '../lib/workforce-api'
import { listAgentPassports, updateAgentPassport } from '../lib/govern-api'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import { listWorkLogs, type WorkLogRow } from '../lib/work-logs-api'
import { listAgendaOccurrences, listTriggers, type AgendaItem } from '../lib/orchestration-api'
import { resolveAgendaAgentId } from '../lib/agenda-label'
import { agentWorkforceRunUrl } from '../lib/workforce-run-urls'
import type { RuntimeAgent } from '../lib/workforce-api'
const AGENTS_DEFAULT_PATH = '/agents'
import { AiAvatar } from '../components/ui/AiAvatar'
import { cn } from '../lib/utils'
import { isOrchestratorAgent } from '../lib/workforce-nav-agents'
import { agentPauseToggleStatus, agentStatusI18nKey, agentWorkState } from '../lib/agent-status'

const STATUS_CLASS: Record<ReturnType<typeof agentWorkState>, string> = {
  working: 'text-status-success',
  ready: 'text-text-muted',
  paused: 'text-text-muted',
  error: 'text-status-error',
}

type AgentPassport = {
  id: string
  name: string
  role: string
  autonomy_level: string | number | null
  allowed_tools: string[]
  permission_scopes: string[]
  is_active: boolean
  runtime_status: string | null
}

export default function AiAgentDetail() {
  const { t, i18n } = useTranslation(['nav', 'common'])
  const { agentId, workLogId } = useParams<{ agentId: string; workLogId?: string }>()
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const { token } = useAuth()
  const [agent, setAgent] = useState<RuntimeAgent | null>(null)
  const [passport, setPassport] = useState<AgentPassport | null>(null)
  const [runs, setRuns] = useState<WorkLogRow[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [internalThreads, setInternalThreads] = useState<InboxThread[]>([])
  const [openConversations, setOpenConversations] = useState<InboxThread[]>([])
  const [openConversationsTotal, setOpenConversationsTotal] = useState(0)
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([])
  const [visualEditing, setVisualEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [leadBusy, setLeadBusy] = useState(false)
  const [autonomyBusy, setAutonomyBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)
  const [duplicateOpen, setDuplicateOpen] = useState(false)

  const load = useCallback(async () => {
    if (!agentId || workLogId) return
    setLoading(true)
    setError(null)
    try {
      const [agentRows, projectRows, passportRows, agendaRows, triggerRows, threadsResult, openThreadsResult] =
        await Promise.all([
        listAgents(),
        listProjects(),
        listAgentPassports()
          .then((r) => r.items as AgentPassport[])
          .catch(() => [] as AgentPassport[]),
        listAgendaOccurrences({
          from: new Date().toISOString(),
          to: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        }).catch(() => [] as AgendaItem[]),
        listTriggers().catch(() => []),
        token
          ? listThreads(token, { folder: 'internal', perPage: 80 }).catch(() => ({ items: [] as InboxThread[] }))
          : Promise.resolve({ items: [] as InboxThread[] }),
        token && agentId
          ? listThreads(token, {
              agentId,
              view: 'all_open',
              perPage: 5,
            }).catch(() => ({ items: [] as InboxThread[], itemsTotal: 0 }))
          : Promise.resolve({ items: [] as InboxThread[], itemsTotal: 0 }),
      ])
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
      setAgent(agentRows.find((a) => a.id === agentId) ?? null)
      setPassport(passportRows.find((p) => p.id === agentId) ?? null)
      setRuns(runRows)
      setProjects(projectRows)
      setInternalThreads(threadsResult.items)
      setOpenConversations(openThreadsResult.items)
      setOpenConversationsTotal(
        Math.max(openThreadsResult.itemsTotal ?? 0, openThreadsResult.items.length),
      )
      const soon = Date.now() - 60_000
      const agentRow = agentRows.find((row) => row.id === agentId)
      const agentHints = agentRow
        ? [{ id: agentRow.id, name: agentRow.name, role_slug: agentRow.role_slug, role_name: agentRow.role_name }]
        : []
      setAgendaItems(
        agendaRows
          .filter((item) => {
            const ownerId = resolveAgendaAgentId(item, triggerRows, agendaRows, agentHints)
            if (ownerId !== agentId) return false
            const at = new Date(item.at.endsWith('Z') || item.at.includes('+') ? item.at : `${item.at}Z`).getTime()
            return Number.isFinite(at) && at >= soon && item.status !== 'done' && item.status !== 'completed'
          })
          .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
      )
    } catch (e) {
      setAgent(null)
      setRuns([])
      setError(
        e instanceof Error ? e.message : t('workforce.agents.detailLoadError'),
      )
    } finally {
      setLoading(false)
    }
  }, [agentId, workLogId, t, token])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (loading || typeof window === 'undefined') return
    if (window.location.hash !== '#conversations') return
    const el = document.getElementById('conversations')
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [loading, openConversations.length])

  const mappedThreads = useMemo(
    () =>
      internalThreads.map((row) => ({
        id: String(row.id),
        emailSubject: row.emailSubject,
        lastMessageAt: row.lastMessageAt,
      })),
    [internalThreads],
  )
  const runTo = useMemo(
    () => (run: WorkLogRow) =>
      workLogRunsPath(run, mappedThreads, agentWorkforceRunUrl(agentId ?? '', run.id)),
    [agentId, mappedThreads],
  )
  const linkedProject = useMemo(() => {
    if (!agent) return null
    return projects.find((project) => project.po_agent_id === agent.id) ?? null
  }, [agent, projects])

  const handleToggleStatus = useCallback(async () => {
    if (!agent || statusBusy) return
    setStatusBusy(true)
    setActionError(null)
    try {
      const next = agentPauseToggleStatus(agent)
      const result = await updateAgentStatus(undefined, agent.id, next)
      setAgent(result.agent)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('workforce.agents.statusUpdateError'))
    } finally {
      setStatusBusy(false)
    }
  }, [agent, statusBusy, t])

  const handleArchive = useCallback(async () => {
    if (!agent || archiveBusy) return
    setArchiveBusy(true)
    setActionError(null)
    try {
      await archiveAgent(undefined, agent.id)
      navigate(AGENTS_DEFAULT_PATH, { replace: true })
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('workforce.agents.archiveError'))
      setArchiveBusy(false)
      setArchiveConfirmOpen(false)
    }
  }, [agent, archiveBusy, navigate, t])

  const handleMakeLead = useCallback(async () => {
    if (!agent || leadBusy) return
    const confirmed = window.confirm(t('workforce.agents.makeLeadConfirm'))
    if (!confirmed) return
    setLeadBusy(true)
    setActionError(null)
    try {
      const result = await setLeadAgent(undefined, agent.id)
      setAgent(result.agent)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('workforce.agents.leadUpdateError'))
    } finally {
      setLeadBusy(false)
    }
  }, [agent, leadBusy, t])

  const handleAutonomyChange = useCallback(
    async (level: string) => {
      if (!agent || autonomyBusy) return
      setAutonomyBusy(true)
      setActionError(null)
      try {
        const result = await updateAgentPassport(agent.id, { autonomy_level: level })
        setPassport(result.passport as unknown as AgentPassport)
      } catch (e) {
        setActionError(e instanceof Error ? e.message : t('workforce.agents.autonomyUpdateError'))
      } finally {
        setAutonomyBusy(false)
      }
    },
    [agent, autonomyBusy, t],
  )

  if (!agentId) {
    return <Navigate to={AGENTS_DEFAULT_PATH} replace />
  }

  if (workLogId) {
    return (
      <PageContent width="xl" className="space-y-4 py-1">
        <Link
          to={`/agents/${agentId}`}
          className="text-sm text-accent hover:underline"
        >
          {t('workforce.agents.backToAgent')}
        </Link>
        <LiveWorkLog workLogId={workLogId} />
      </PageContent>
    )
  }

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      <Link to={AGENTS_DEFAULT_PATH} className="text-sm text-accent hover:underline">
        {t('workforce.agents.backToList')}
      </Link>

      {loading ? (
        <CardGridSkeleton cards={4} className="lg:grid-cols-2" />
      ) : !agent ? (
        <Card className="p-4">
          <p className="text-sm text-status-error">
            {error ?? t('workforce.agents.notFound')}
          </p>
          {error ? (
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => void load()}>
              {t('common:actions.retry')}
            </Button>
          ) : null}
        </Card>
      ) : (
        <>
          <Card className="px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <AiAvatar
                  name={agent.name}
                  seed={agent.id}
                  size={34}
                  className="mt-0.5"
                  kind={agent.avatar_kind}
                  icon={agent.avatar_icon}
                  color={agent.avatar_color}
                  imageUrl={agent.avatar_image_url}
                />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-text-heading">{agent.name}</h2>
                    {agent.is_lead ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/8 px-2 py-0.5 text-[11px] font-medium text-accent"
                        title={t('workforce.agents.leadHint')}
                      >
                        <Crown size={11} aria-hidden />
                        {t('workforce.agents.leadBadge')}
                      </span>
                    ) : null}
                    {isAdmin && agent.kind !== 'personal' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-text-muted hover:text-text-heading"
                        title={t('workforce.agents.visualEdit')}
                        aria-label={t('workforce.agents.visualEdit')}
                        aria-expanded={visualEditing}
                        onClick={() => {
                          setVisualEditing((open) => !open)
                          if (!visualEditing) {
                            requestAnimationFrame(() => {
                              document.getElementById('agent-visual')?.scrollIntoView({
                                behavior: 'smooth',
                                block: 'nearest',
                              })
                            })
                          }
                        }}
                      >
                        <Pencil size={14} aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-sm text-text-muted">
                    {agentRoleLabel(agent.role_name || agent.role_slug, t)}
                  </p>
                </div>
              </div>
              <span
                className={cn('text-sm font-medium', STATUS_CLASS[agentWorkState(agent)])}
              >
                {t(agentStatusI18nKey(agentWorkState(agent)))}
              </span>
            </div>
            {agent.current_activity_summary ? (
              <p className="mt-2 text-sm text-text-secondary">{agent.current_activity_summary}</p>
            ) : null}
            {isOrchestratorAgent(agent) && linkedProject ? (
              <div className="mt-3 rounded-lg border border-border/60 bg-bg-input/35 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                  {t('workforce.agents.types.orchestrator')}
                </p>
                <Link
                  to={`/projects/${linkedProject.id}`}
                  className="mt-1 block text-sm font-medium text-text-heading hover:underline"
                >
                  {linkedProject.name}
                </Link>
              </div>
            ) : null}
            {!isAdmin ? (
              <p className="mt-3 rounded-lg border border-border/60 bg-bg-input/40 px-3 py-2 text-xs text-text-muted">
                {t('workforce.agents.readonlyBanner')}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {agent.kind !== 'personal' ? (
                <Button type="button" size="sm" variant="outline" asChild>
                  <Link to={agentChatPath(agent.id)}>
                    <MessageSquare size={14} className="mr-1.5" aria-hidden />
                    {t('workforce.agents.chatWith')}
                  </Link>
                </Button>
              ) : null}
              <Button type="button" size="sm" variant="outline" asChild>
                <Link to={`/agenda?agent=${agent.id}`}>
                  <CalendarDays size={14} className="mr-1.5" aria-hidden />
                  {t('workforce.agents.openAgenda')}
                </Link>
              </Button>
              <Button type="button" size="sm" variant="outline" asChild>
                <Link to={`${agentRunsPath('all')}?agent=${encodeURIComponent(agent.id)}`}>
                  <MessageSquare size={14} className="mr-1.5" aria-hidden />
                  {t('workforce.agents.openThreads')}
                </Link>
              </Button>
              {isAdmin ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={statusBusy}
                  onClick={() => void handleToggleStatus()}
                >
                  {agentWorkState(agent) === 'paused' ? (
                    <Play size={14} className="mr-1.5" aria-hidden />
                  ) : (
                    <Pause size={14} className="mr-1.5" aria-hidden />
                  )}
                  {agentWorkState(agent) === 'paused'
                    ? t('workforce.agents.wake')
                    : t('workforce.agents.pause')}
                </Button>
              ) : null}
              {isAdmin && agent.kind !== 'personal' && !agent.is_lead ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={leadBusy}
                  onClick={() => void handleMakeLead()}
                >
                  <Crown size={14} className="mr-1.5" aria-hidden />
                  {t('workforce.agents.makeLead')}
                </Button>
              ) : null}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button type="button" size="sm" variant="ghost" aria-label={t('workforce.agents.moreActions')}>
                    <MoreHorizontal size={14} className="mr-1.5" aria-hidden />
                    {t('workforce.agents.moreActions')}
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={4}
                    className="z-50 min-w-[200px] rounded-lg border border-border/60 bg-bg-surface p-1 shadow-overlay"
                  >
                    <DropdownMenu.Item asChild>
                      <Link
                        to="/knowledge"
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text-primary outline-none data-[highlighted]:bg-bg-hover"
                        title={t('workforce.agents.knowledgeHint')}
                      >
                        <Network size={14} />
                        {t('workforce.agents.openKnowledge')}
                      </Link>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item asChild>
                      <Link
                        to="/settings/communication"
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text-primary outline-none data-[highlighted]:bg-bg-hover"
                      >
                        <Settings size={14} />
                        {t('workforce.agents.openInboxAi')}
                      </Link>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item asChild>
                      <Link
                        to="/settings/setup"
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text-primary outline-none data-[highlighted]:bg-bg-hover"
                      >
                        {t('workforce.agents.openSetup')}
                      </Link>
                    </DropdownMenu.Item>
                    {(agent.role_slug === 'orchestrator' || agent.role_slug === 'po' || agent.role_slug === 'orchestra') ? (
                      <DropdownMenu.Item asChild>
                        <Link
                          to="/settings/govern?tab=policy"
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text-primary outline-none data-[highlighted]:bg-bg-hover"
                        >
                          <ShieldCheck size={14} />
                          {t('workforce.agents.openGovern')}
                        </Link>
                      </DropdownMenu.Item>
                    ) : null}
                    {isAdmin ? (
                      <DropdownMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text-primary outline-none data-[highlighted]:bg-bg-hover"
                        onSelect={() => setDuplicateOpen(true)}
                      >
                        <Copy size={14} />
                        {t('workforce.agents.duplicate')}
                      </DropdownMenu.Item>
                    ) : null}
                    {isAdmin && !agent.is_lead ? (
                      <>
                        <DropdownMenu.Separator className="my-1 h-px bg-border/60" />
                        <DropdownMenu.Item
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-status-error outline-none data-[highlighted]:bg-bg-hover"
                          onSelect={() => setArchiveConfirmOpen(true)}
                        >
                          <Archive size={14} />
                          {t('workforce.agents.archive')}
                        </DropdownMenu.Item>
                      </>
                    ) : null}
                    {isAdmin && agent.is_lead ? (
                      <>
                        <DropdownMenu.Separator className="my-1 h-px bg-border/60" />
                        <DropdownMenu.Item
                          disabled
                          className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text-muted outline-none"
                        >
                          {t('workforce.agents.leadArchiveBlocked')}
                        </DropdownMenu.Item>
                      </>
                    ) : null}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
            {archiveConfirmOpen ? (
              <div className="mt-3 rounded-lg border border-status-error/30 bg-status-error/5 px-3 py-2">
                <p className="text-sm text-text-heading">{t('workforce.agents.archiveConfirm')}</p>
                <p className="mt-1 text-xs text-text-muted">{t('workforce.agents.archiveSuggestPause')}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setArchiveConfirmOpen(false)}>
                    {t('workforce.agents.archiveCancel')}
                  </Button>
                  {agentWorkState(agent) !== 'paused' ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => void handleToggleStatus()}>
                      {t('workforce.agents.pause')}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-status-error hover:text-status-error"
                    disabled={archiveBusy}
                    onClick={() => void handleArchive()}
                  >
                    {t('workforce.agents.archiveConfirmAction')}
                  </Button>
                </div>
              </div>
            ) : null}
            {actionError ? <p className="mt-2 text-sm text-status-error">{actionError}</p> : null}
          </Card>
          <NewAgentDialog
            open={duplicateOpen}
            onOpenChange={setDuplicateOpen}
            onCreated={(agentId) => navigate(`/agents/${agentId}`)}
            prefill={{
              name: t('workforce.agents.duplicateName', { name: agent.name }),
              role: agent.role_slug ?? undefined,
              model: agent.model ?? undefined,
              systemPrompt: agent.system_prompt ?? undefined,
            }}
          />

          {agent.kind !== 'personal' ? (
            <AgentVisualCard
              agentId={agent.id}
              agentName={agent.name}
              avatarKind={agent.avatar_kind}
              avatarIcon={agent.avatar_icon}
              avatarColor={agent.avatar_color}
              avatarImageUrl={agent.avatar_image_url}
              canEdit={isAdmin}
              hideChrome
              editing={visualEditing}
              onEditingChange={setVisualEditing}
              onChanged={() => void load()}
            />
          ) : null}

          <div
            id="conversations"
            className="grid scroll-mt-4 gap-4 lg:grid-cols-2"
          >
            <Card className="flex min-h-0 flex-col px-4 py-3">
              <div>
                <h3 className="text-base font-semibold text-text-heading">
                  {t('workforce.agents.conversationsTitle')}
                </h3>
                <p className="text-sm text-text-muted">
                  {t('workforce.agents.conversationsDescription')}
                </p>
              </div>
              {openConversations.length === 0 ? (
                <p className="mt-3 text-sm text-text-muted">{t('workforce.agents.conversationsEmpty')}</p>
              ) : (
                <div className="mt-3 flex flex-1 flex-col">
                  <div className="space-y-1.5">
                    {openConversations.slice(0, 5).map((thread) => {
                      const needsDecision = Boolean(thread.hasOpenDecision)
                      return (
                        <Link
                          key={String(thread.id)}
                          to={agentChatPath(agent.id, { queue: 'open', threadId: String(thread.id) })}
                          className="flex items-center gap-3 rounded-lg border border-border/60 bg-bg-elevated/45 px-3 py-2 text-sm transition-colors hover:border-accent/40"
                        >
                          <MessageSquare size={13} className="shrink-0 text-text-muted" aria-hidden />
                          <span className="min-w-0 flex-1 truncate font-medium text-text-heading">
                            {thread.emailSubject || t('workforce.agents.conversationUntitled')}
                          </span>
                          {needsDecision ? (
                            <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-accent">
                              {t('workforce.agents.needsDecisionBadge')}
                            </span>
                          ) : null}
                          {thread.lastMessageAt ? (
                            <span
                              className="shrink-0 text-xs tabular-nums text-text-muted"
                              title={formatAppDateTime(new Date(thread.lastMessageAt), i18n.language)}
                            >
                              {formatAppDateTime(new Date(thread.lastMessageAt), i18n.language)}
                            </span>
                          ) : null}
                        </Link>
                      )
                    })}
                  </div>
                  <div className="mt-3 border-t border-border/50 pt-3">
                    <Button type="button" size="sm" variant="outline" className="w-full" asChild>
                      <Link to={agentChatPath(agent.id, { queue: 'open' })}>
                        {t('workforce.agents.viewAllConversations', {
                          count: openConversationsTotal,
                          defaultValue: 'View all ({{count}})',
                        })}
                      </Link>
                    </Button>
                  </div>
                </div>
              )}
            </Card>

            <Card className="flex min-h-0 flex-col px-4 py-3">
              <div>
                <h3 className="text-base font-semibold text-text-heading">
                  {t('workforce.agents.agendaTitle')}
                </h3>
                <p className="text-sm text-text-muted">
                  {t('workforce.agents.agendaDescription')}
                </p>
              </div>
              {agendaItems.length === 0 ? (
                <div className="mt-3 flex flex-1 flex-col">
                  <p className="text-sm text-text-muted">{t('workforce.agents.agendaEmptyHint')}</p>
                  <div className="mt-auto border-t border-border/50 pt-3">
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" className="flex-1" asChild>
                        <Link to={`/agenda?agent=${agent.id}`}>
                          {t('workforce.agents.scheduleOnAgenda')}
                        </Link>
                      </Button>
                      <Button type="button" size="sm" variant="ghost" asChild>
                        <Link to={AGENDA_AUTOMATIONS_PATH}>
                          {t('workforce.agents.openAgendaAutomations')}
                        </Link>
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex flex-1 flex-col">
                  <div className="space-y-1.5">
                    {agendaItems.slice(0, 5).map((item) => {
                      const href = agendaOccurrenceHref(item, mappedThreads, agent.id)
                      const at = new Date(item.at.endsWith('Z') ? item.at : `${item.at}Z`)
                      return (
                        <Link
                          key={item.id}
                          to={href}
                          className="flex items-center gap-3 rounded-lg border border-border/60 bg-bg-elevated/45 px-3 py-2 text-sm transition-colors hover:border-accent/40"
                        >
                          <CalendarDays size={13} className="shrink-0 text-text-muted" aria-hidden />
                          <span className="min-w-0 flex-1 truncate font-medium text-text-heading">
                            {translateDecisionText(item.name, t) || item.name}
                          </span>
                          <span className="shrink-0 text-xs text-text-muted">{agendaKindLabel(item.kind, t)}</span>
                          <span className="shrink-0 text-xs tabular-nums text-text-muted">
                            {formatAppWeekdayDateTime(at, i18n.language)}
                          </span>
                        </Link>
                      )
                    })}
                  </div>
                  <div className="mt-3 border-t border-border/50 pt-3">
                    <Button type="button" size="sm" variant="outline" className="w-full" asChild>
                      <Link to={`/agenda?agent=${agent.id}`}>
                        {t('workforce.agents.viewAllAgenda', {
                          count: agendaItems.length,
                          defaultValue: 'View all ({{count}})',
                        })}
                      </Link>
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </div>

          {agent.kind !== 'personal' ? (
            <AgentInstructionsCard
              agentId={agent.id}
              name={agent.name}
              systemPrompt={agent.system_prompt ?? ''}
              canEdit={isAdmin}
              onChanged={() => void load()}
            />
          ) : null}

          {agent.kind !== 'personal' ? (
            <AgentSignatureCard
              agentId={agent.id}
              agentName={agent.name}
              signatureText={agent.email_signature_text ?? ''}
              replySendAs={agent.reply_send_as === 'user' ? 'user' : 'agent'}
              canEdit={isAdmin}
              onChanged={() => void load()}
            />
          ) : null}

          {/* Chat access is a company-agent concept; the API 404s for personal agents. */}
          {agent.kind !== 'personal' ? <AgentChatAccessCard agentId={agent.id} /> : null}

          <AgentModelCard
            agentId={agent.id}
            currentModel={agent.model}
            canEdit={isAdmin}
            onChanged={() => void load()}
          />

          <Card className="px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-text-heading">
                  {t('workforce.agents.permissionsTitle')}
                </h3>
                <p className="text-sm text-text-muted">
                  {t('workforce.agents.permissionsDescription')}
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" asChild>
                <Link to="/settings/govern?tab=policy">
                  <ShieldCheck size={14} className="mr-1.5" aria-hidden />
                  {t('workforce.agents.editPolicies')}
                </Link>
              </Button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                  {t('workforce.agents.autonomyLevel')}
                </p>
                {isAdmin ? (
                  <select
                    className="mt-1 w-full max-w-[180px] rounded-md border border-border bg-bg-input px-2 py-1.5 text-sm text-text-heading focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
                    value={
                      passport?.autonomy_level != null && passport.autonomy_level !== ''
                        ? String(passport.autonomy_level)
                        : 'approval'
                    }
                    disabled={autonomyBusy}
                    onChange={(e) => void handleAutonomyChange(e.target.value)}
                  >
                    <option value="manual">
                      {t('workforce.agents.autonomyManual')}
                    </option>
                    <option value="approval">
                      {t('workforce.agents.autonomyApproval')}
                    </option>
                    <option value="auto">
                      {t('workforce.agents.autonomyAuto')}
                    </option>
                  </select>
                ) : (
                  <p className="mt-1 text-sm font-medium text-text-heading">
                    {agentAutonomyLevelLabel(
                      passport?.autonomy_level != null && passport.autonomy_level !== ''
                        ? String(passport.autonomy_level)
                        : null,
                      t,
                    )}
                  </p>
                )}
                <p className="mt-1.5 text-[11px] text-text-muted">
                  {t(
                    {
                      manual: 'workforce.agents.autonomyManualHint',
                      approval: 'workforce.agents.autonomyApprovalHint',
                      auto: 'workforce.agents.autonomyAutoHint',
                    }[
                      passport?.autonomy_level != null && passport.autonomy_level !== ''
                        ? String(passport.autonomy_level)
                        : 'approval'
                    ] ?? 'workforce.agents.autonomyApprovalHint',
                  )}{' '}
                  <Link to="/settings/govern?tab=policy" className="font-medium text-accent hover:underline">
                    {t('workforce.agents.autonomyGovernLink')}
                  </Link>
                </p>
              </div>
              <div className="sm:col-span-2">
                <AgentToolsPicker
                  agentId={agent.id}
                  allowedTools={passport?.allowed_tools ?? []}
                  canEdit={isAdmin}
                  onSaved={(tools) =>
                    setPassport((prev) => (prev ? { ...prev, allowed_tools: tools } : prev))
                  }
                />
              </div>
              {passport && passport.permission_scopes.length > 0 ? (
                <div className="sm:col-span-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                    {t('workforce.agents.permissionScopes')}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {passport.permission_scopes.map((scope) => (
                      <span
                        key={scope}
                        className="rounded-full border border-accent/30 bg-accent/8 px-2 py-0.5 text-[11px] text-accent"
                      >
                        {permissionScopeLabel(scope, t)}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </Card>

          <div className="space-y-2">
            <h3 className="text-base font-semibold text-text-heading">
              {t('workforce.agents.historyTitle')}
            </h3>
            <p className="text-sm text-text-muted">{t('workforce.agents.historyDescription')}</p>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {runs.length === 0 ? (
              <EmptyState
                title={t('workforce.runs.empty')}
                description={t('workforce.agents.runsEmptyHint')}
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    {agent.kind !== 'personal' ? (
                      <Button size="sm" asChild>
                        <Link to={agentChatPath(agent.id)}>{t('workforce.agents.chatWith')}</Link>
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" asChild>
                      <Link to={agentRunsPath('all')}>{t('workforce.agents.openCommunication')}</Link>
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/agenda?agent=${agent.id}`}>{t('agendaPage.openAgenda')}</Link>
                    </Button>
                  </div>
                }
              />
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
