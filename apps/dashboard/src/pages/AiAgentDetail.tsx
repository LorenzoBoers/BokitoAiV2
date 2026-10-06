import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentPassport } from '../lib/workforce-api'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { Archive, CalendarDays, Copy, MessageSquare, MoreHorizontal, Pencil, RotateCcw, ShieldCheck } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { PageRelatedLinks } from '../components/layout/PageRelatedLinks'
import { ThreadStatusDot } from '../components/ui/ThreadStatusDot'
import { NewAgentDialog } from '../components/workforce/NewAgentDialog'
import { LiveWorkLog } from '../components/observability/LiveWorkLog'
import { WorkLogsTable } from '../components/workforce/WorkLogsTable'
import { AgentChatAccessCard } from '../components/workforce/AgentChatAccessCard'
import { AgentModelCard } from '../components/workforce/AgentModelCard'
import { AgentToolsPicker } from '../components/workforce/AgentToolsPicker'
import { AgentInstructionsCard } from '../components/workforce/AgentInstructionsCard'
import { AgentSignatureCard } from '../components/workforce/AgentSignatureCard'
import { AgentAskTargetCard } from '../components/workforce/AgentAskTargetCard'
import { AgentRulesEditor } from '../components/workforce/AgentRulesEditor'
import { AgentActivityTimeline } from '../components/workforce/AgentActivityTimeline'
import { AgentIdentityDialog } from '../components/workforce/AgentIdentityDialog'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { EmptyState } from '../components/ui/empty-state'
import { PageContent } from '../components/layout/PageContent'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { listAgents } from '../lib/agents-api'
import { agendaKindLabel } from '../lib/status-labels'
import { translateDecisionText } from '../lib/activity-labels'
import { activityTerminalPath, agentChatPath } from '../lib/messages-paths'
import { withNavReveal } from '../lib/nav-reveal'
import { openEntityPath, runThreadPath } from '../lib/open-entity'
import { agendaKindOf, listTimeItems, parseTimelineMs, timeItemHref, type TimeItem } from '../lib/time-items'
import { formatAppDateTime, formatAppWeekdayDateTime } from '../lib/app-locale'
import { AGENDA_AUTOMATIONS_PATH } from '../lib/navigation'
import { listThreads, type InboxThread } from '../lib/inbox-api'
import { archiveAgent, restoreAgent } from '../lib/workforce-api'
import { listAgentPassports } from '../lib/govern-api'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import { listWorkLogs, type WorkLogRow } from '../lib/work-logs-api'
import type { RuntimeAgent } from '../lib/workforce-api'
const AGENTS_DEFAULT_PATH = '/agents'
import { AiAvatar } from '../components/ui/AiAvatar'
import { cn } from '../lib/utils'
import { isOrchestratorAgent } from '../lib/workforce-nav-agents'
import { useAgentLive, seedAgentPresence, withAgentLive } from '../hooks/useAgentPresence'
import { agentStatusOf, presenceLabel, presenceTextClass } from '../lib/presence'

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
  const [agendaItems, setAgendaItems] = useState<TimeItem[]>([])
  const [identityOpen, setIdentityOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)
  const [duplicateOpen, setDuplicateOpen] = useState(false)

  const load = useCallback(async () => {
    if (!agentId || workLogId) return
    setLoading(true)
    setError(null)
    try {
      const [agentRows, projectRows, passportRows, agendaRows, threadsResult, openThreadsResult] =
        await Promise.all([
        listAgents(),
        listProjects(),
        listAgentPassports()
          .then((r) => r.items)
          .catch(() => [] as AgentPassport[]),
        listTimeItems({
          from: new Date(Date.now() - 60_000).toISOString(),
          to: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          agentId,
          sources: ['wake', 'checkup', 'follow_up'],
        })
          .then((window) => window.items)
          .catch(() => [] as TimeItem[]),
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
      const found = agentRows.find((a) => a.id === agentId) ?? null
      setAgent(found)
      if (found) seedAgentPresence([found])
      setPassport(passportRows.find((p) => p.id === agentId) ?? null)
      setRuns(runRows)
      setProjects(projectRows)
      setInternalThreads(threadsResult.items)
      setOpenConversations(openThreadsResult.items)
      setOpenConversationsTotal(
        Math.max(openThreadsResult.itemsTotal ?? 0, openThreadsResult.items.length),
      )
      setAgendaItems(agendaRows.filter((item) => item.status !== 'done' && item.status !== 'completed'))
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

  const live = useAgentLive(agentId)
  const view = agent ? withAgentLive(agent) : null
  const work = view ? agentStatusOf(view) : 'standby'
  const workHref = agentId && work === 'working' ? openEntityPath({ type: 'agent', id: agentId, live }) : null
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
      runThreadPath({ ...run, agent_id: run.agent_id ?? agentId }, mappedThreads),
    [agentId, mappedThreads],
  )
  const linkedProject = useMemo(() => {
    if (!agent) return null
    return projects.find((project) => project.po_agent_id === agent.id) ?? null
  }, [agent, projects])

  const handleArchive = useCallback(async () => {
    if (!agent || archiveBusy) return
    setArchiveBusy(true)
    setActionError(null)
    try {
      await archiveAgent(undefined, agent.id)
      setArchiveConfirmOpen(false)
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('workforce.agents.archiveError'))
    } finally {
      setArchiveBusy(false)
    }
  }, [agent, archiveBusy, load, t])

  const handleRestore = useCallback(async () => {
    if (!agent || archiveBusy) return
    setArchiveBusy(true)
    setActionError(null)
    try {
      await restoreAgent(undefined, agent.id)
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('workforce.agents.restoreError'))
    } finally {
      setArchiveBusy(false)
    }
  }, [agent, archiveBusy, load, t])

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
                  imageUrl={agent.avatar_image_url}
                  activity={
                    work === 'working' ? 'working' : work === 'error' ? 'error' : 'standby'
                  }
                />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-text-heading">{agent.name}</h2>
                    {agent.managed ? (
                      <span
                        className="rounded border border-border/70 px-1.5 py-0.5 text-2xs font-medium text-text-muted"
                        title={
                          agent.origin_label
                            ? t('workforce.agents.managedBadgeHint', { origin: agent.origin_label })
                            : t('workforce.agents.managedBadge')
                        }
                      >
                        {t('workforce.agents.managedBadge')}
                      </span>
                    ) : null}
                  </div>
                  <p
                    className={cn(
                      'mt-0.5 text-sm font-medium',
                      agent.is_active === false
                        ? presenceTextClass('deactivated')
                        : presenceTextClass(work),
                    )}
                  >
                    {agent.is_active === false
                      ? presenceLabel('deactivated', t)
                      : presenceLabel(work, t)}
                  </p>
                  {work === 'working' && (view?.current_activity_summary || live?.summary) ? (
                    workHref ? (
                      <Link to={workHref} className="mt-1 block text-sm text-text-secondary hover:text-text-heading">
                        {view?.current_activity_summary || live?.summary}
                      </Link>
                    ) : (
                      <p className="mt-1 text-sm text-text-secondary">
                        {view?.current_activity_summary || live?.summary}
                      </p>
                    )
                  ) : null}
                  {workHref ? (
                    <Link to={workHref} className="mt-1 inline-block text-xs font-medium text-accent hover:underline">
                      {t('workforce.agents.openCurrentWork')}
                    </Link>
                  ) : null}
                </div>
              </div>
              {isAdmin && agent.kind !== 'personal' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() => setIdentityOpen(true)}
                >
                  <Pencil size={14} className="mr-1.5" aria-hidden />
                  {t('workforce.agents.editIdentity')}
                </Button>
              ) : null}
            </div>
            {agent.is_active === false ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-bg-elevated px-3 py-2">
                <p className="text-sm text-text-secondary">{t('workforce.agents.deactivatedBanner')}</p>
                {isAdmin ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={archiveBusy}
                    onClick={() => void handleRestore()}
                  >
                    <RotateCcw size={14} className="mr-1.5" />
                    {t('workforce.agents.restore')}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {isOrchestratorAgent(agent) && linkedProject ? (
              <p className="mt-2 text-sm text-text-muted">
                <Link to={`/projects/${linkedProject.id}`} className="font-medium text-accent hover:underline">
                  {t('workforce.agents.projectLink', { name: linkedProject.name })}
                </Link>
              </p>
            ) : null}
            {!isAdmin ? (
              <p className="mt-3 text-xs text-text-muted">{t('workforce.agents.readonlyBanner')}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {agent.kind !== 'personal' && agent.is_active !== false ? (
                <Button type="button" size="sm" variant="outline" asChild>
                  <Link to={withNavReveal(agentChatPath(agent.id))}>
                    <MessageSquare size={14} className="mr-1.5" aria-hidden />
                    {t('workforce.agents.chatWith')}
                  </Link>
                </Button>
              ) : null}
              <Link
                to={`/agenda?agent=${agent.id}`}
                className="text-xs font-medium text-text-muted hover:text-accent hover:underline"
              >
                {t('workforce.agents.openAgenda')}
              </Link>
              <Link
                to={activityTerminalPath(agent.id)}
                className="text-xs font-medium text-text-muted hover:text-accent hover:underline"
              >
                {t('workforce.agents.openThreads')}
              </Link>
              {isAdmin ? (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-8 px-2 text-text-muted"
                      aria-label={t('workforce.agents.moreActions')}
                    >
                      <MoreHorizontal size={16} aria-hidden />
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      align="end"
                      sideOffset={4}
                      className="z-50 min-w-[180px] rounded-lg border border-border/60 bg-bg-surface p-1 shadow-overlay"
                    >
                      <DropdownMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text-primary outline-none data-[highlighted]:bg-bg-hover"
                        onSelect={() => setDuplicateOpen(true)}
                      >
                        <Copy size={14} />
                        {t('workforce.agents.duplicate')}
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator className="my-1 h-px bg-border/60" />
                      {agent.is_active === false ? (
                        <DropdownMenu.Item
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text-primary outline-none data-[highlighted]:bg-bg-hover"
                          onSelect={() => void handleRestore()}
                        >
                          <RotateCcw size={14} />
                          {t('workforce.agents.restore')}
                        </DropdownMenu.Item>
                      ) : (
                        <DropdownMenu.Item
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-status-error outline-none data-[highlighted]:bg-bg-hover"
                          onSelect={() => setArchiveConfirmOpen(true)}
                        >
                          <Archive size={14} />
                          {t('workforce.agents.archive')}
                        </DropdownMenu.Item>
                      )}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              ) : null}
            </div>
            {archiveConfirmOpen && agent.is_active !== false ? (
              <div className="mt-3 rounded-lg border border-status-error/30 bg-status-error/5 px-3 py-2">
                <p className="text-sm text-text-heading">
                  {agent.managed
                    ? t('workforce.agents.archiveConfirmManaged', {
                        origin: agent.origin_label || t('workforce.agents.managedBadge'),
                      })
                    : t('workforce.agents.archiveConfirm')}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setArchiveConfirmOpen(false)}>
                    {t('workforce.agents.archiveCancel')}
                  </Button>
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
          <AgentActivityTimeline agentId={agent.id} />
          <NewAgentDialog
            open={duplicateOpen}
            onOpenChange={setDuplicateOpen}
            onCreated={(agentId) => navigate(`/agents/${agentId}`)}
            prefill={{
              name: t('workforce.agents.duplicateName', { name: agent.name }),
              model: agent.model ?? undefined,
              purpose: agent.purpose ?? agent.system_prompt ?? undefined,
            }}
          />

          {agent.kind !== 'personal' ? (
            <AgentIdentityDialog
              open={identityOpen}
              onOpenChange={setIdentityOpen}
              agentId={agent.id}
              agentName={agent.name}
              avatarKind={agent.avatar_kind}
              avatarIcon={agent.avatar_icon}
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
                          to={agentChatPath(agent.id, String(thread.id))}
                          className="flex items-center gap-3 rounded-md border border-transparent px-3 py-2 text-sm transition-colors hover:bg-bg-hover/70"
                        >
                          <ThreadStatusDot status={thread.status} unread={thread.hasUnread} />
                          <span className="min-w-0 flex-1 truncate-fade font-medium text-text-heading">
                            {thread.emailSubject || t('workforce.agents.conversationUntitled')}
                          </span>
                          {needsDecision ? (
                            <span className="shrink-0 text-2xs font-medium text-accent">
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
                      <Link to={withNavReveal(agentChatPath(agent.id))}>
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
                        <Link to={`/agenda?agent=${agent.id}&new=once`}>
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
                      const href = timeItemHref(item, mappedThreads)
                      const at = new Date(parseTimelineMs(item.start))
                      return (
                        <Link
                          key={item.id}
                          to={href}
                          className="flex items-center gap-3 rounded-md border border-transparent px-3 py-2 text-sm transition-colors hover:bg-bg-hover/70"
                        >
                          <CalendarDays size={13} className="shrink-0 text-text-muted" aria-hidden />
                          <span className="min-w-0 flex-1 truncate-fade font-medium text-text-heading">
                            {translateDecisionText(item.title, t) || item.title}
                          </span>
                          <span className="shrink-0 text-xs text-text-muted">{agendaKindLabel(agendaKindOf(item), t)}</span>
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

          {agent.kind !== 'personal' ? (
            <AgentAskTargetCard
              agentId={agent.id}
              askTarget={agent.ask_target}
              canEdit={isAdmin}
              onChanged={() => void load()}
            />
          ) : null}

          {agent.kind !== 'personal' ? <AgentRulesEditor agentId={agent.id} canEdit canGrant={isAdmin} /> : null}

          {/* Chat access is a company-agent concept; the API 404s for personal agents. */}
          {agent.kind !== 'personal' ? <AgentChatAccessCard agentId={agent.id} /> : null}

          <AgentModelCard
            agentId={agent.id}
            currentModel={agent.model}
            canEdit={isAdmin}
            onChanged={() => void load()}
          />

          <Card id="tools" className="px-4 py-3">
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
            <div className="mt-3">
              <div>
                <AgentToolsPicker
                  agentId={agent.id}
                  allowedTools={passport?.tools ?? []}
                  canEdit={isAdmin}
                  onSaved={(tools) =>
                    setPassport((prev) => (prev ? { ...prev, tools } : prev))
                  }
                />
              </div>
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
                  agent.kind !== 'personal' ? (
                    <Button size="sm" asChild>
                      <Link to={withNavReveal(agentChatPath(agent.id))}>{t('workforce.agents.chatWith')}</Link>
                    </Button>
                  ) : (
                    <Button size="sm" asChild>
                      <Link to={`/agenda?agent=${agent.id}`}>{t('agendaPage.openAgenda')}</Link>
                    </Button>
                  )
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

          <PageRelatedLinks
            links={[
              { to: '/settings/communication', label: t('workforce.agents.relatedInboxAi') },
              { to: '/knowledge', label: t('workforce.agents.relatedKnowledge') },
              { to: '/settings/govern?tab=policy', label: t('workforce.agents.relatedGovern') },
              { to: '/docs/ai/agents', label: t('pageGuides.learnMore') },
            ]}
          />
        </>
      )}
    </PageContent>
  )
}
