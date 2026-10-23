import { Pressable } from '../components/ui/pressable'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { TextLink } from '../components/ui/text-link'
import type { AgentPassport } from '../lib/workforce-api'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { Archive, ArrowLeft, CalendarDays, Copy, History, MessageSquare, MoreHorizontal, Pencil, RotateCcw, Settings, ShieldCheck } from 'lucide-react'
import { NameEdit } from '../components/ui/NameEdit'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { PageRelatedLinks } from '../components/layout/PageRelatedLinks'
import { OpenInGridButton } from '../components/org/OpenInGridButton'
import { ThreadStatusDot } from '../components/ui/ThreadStatusDot'
import { NewAgentDialog } from '../components/workforce/NewAgentDialog'
import { AgentModuleOrigin } from '../components/workforce/AgentModuleOrigin'
import { LiveWorkLog } from '../components/observability/LiveWorkLog'
import { WorkLogsTable } from '../components/workforce/WorkLogsTable'
import { AgentChatAccessCard } from '../components/workforce/AgentChatAccessCard'
import { AgentModelCard } from '../components/workforce/AgentModelCard'
import { AgentToolsPicker } from '../components/workforce/AgentToolsPicker'
import { AgentInstructionsCard } from '../components/workforce/AgentInstructionsCard'
import { AgentSignatureCard } from '../components/workforce/AgentSignatureCard'
import { AgentAskTargetCard } from '../components/workforce/AgentAskTargetCard'
import { AgentRulesEditor } from '../components/workforce/AgentRulesEditor'
import { AgentDefinitionCard } from '../components/workforce/AgentDefinitionCard'
import { AgentActivityTimeline } from '../components/workforce/AgentActivityTimeline'
import { AgentIdentityDialog } from '../components/workforce/AgentIdentityDialog'
import { Button } from '../components/ui/button'
import { PageHeader } from '../components/ui/page-header'
import { Card } from '../components/ui/card'
import { AgentIdentitySkeleton } from '../components/ui/skeleton'
import { EmptyState } from '../components/ui/empty-state'
import { PageContent } from '../components/layout/PageContent'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { getAgent } from '../lib/agents-api'
import { agendaKindLabel } from '../lib/status-labels'
import { translateDecisionText } from '../lib/activity-labels'
import { agentChatPath, newConversationPath } from '../lib/messages-paths'
import { withNavReveal } from '../lib/nav-reveal'
import { openEntityPath, runThreadPath } from '../lib/open-entity'
import { agendaKindOf, listTimeItems, parseTimelineMs, timeItemHref, type TimeItem } from '../lib/time-items'
import { formatAppDateTime, formatAppWeekdayDateTime } from '../lib/app-locale'
import { TAB_PATHS, AUTONOMY_PATH } from '../lib/navigation'
import { listThreads, type InboxThread } from '../lib/inbox-api'
import { archiveAgent, getAgentAwareness, patchAgentAwareness, restoreAgent } from '../lib/workforce-api'
import { AwarenessEditor } from './DepartmentPage'
import type { DepartmentAwareness } from '../lib/teams-api'
import { listAgentPassports } from '../lib/govern-api'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import { listWorkLogs, type WorkLogRow } from '../lib/work-logs-api'
import type { RuntimeAgent } from '../lib/workforce-api'
const AGENTS_DEFAULT_PATH = '/agents'
import { Avatar } from '../components/ui/avatar'
import { agentProfileAccentColor, resolveAgentAvatarColor } from '../lib/agent-avatar'
import { isOrchestratorAgent } from '../lib/workforce-nav-agents'
import { useAgentLive, seedAgentPresence, withAgentLive } from '../hooks/useAgentPresence'
import { useAgentOrbDrive } from '../hooks/useBotOrbPulse'
import { presenceOrbMotion } from '../lib/bot-orb-motion'
import { agentStatusOf } from '../lib/presence'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'

/** Profile hero mark — large enough to read as identity, not a form icon. */
const HERO_MARK_SIZE = 128

export default function AiAgentDetail() {
  const { t, i18n } = useTranslation(['nav', 'common'])
  const { agentId, workLogId } = useParams<{ agentId: string; workLogId?: string }>()
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const { token } = useAuth()
  const [agent, setAgent] = useState<RuntimeAgent | null>(null)
  const [passport, setPassport] = useState<AgentPassport | null>(null)
  const [runs, setRuns] = useState<WorkLogRow[]>([])
  const [runsMore, setRunsMore] = useState(false)
  const [loadingMoreRuns, setLoadingMoreRuns] = useState(false)
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [awareness, setAwareness] = useState<DepartmentAwareness | null>(null)

  useEffect(() => {
    if (!settingsOpen || !token || !agentId) return
    void getAgentAwareness(token, agentId).then(setAwareness).catch(() => setAwareness(null))
  }, [settingsOpen, token, agentId])

  const load = useCallback(async () => {
    if (!agentId || workLogId) return
    setLoading(true)
    setError(null)
    try {
      const [foundAgent, projectRows, passportRows, agendaRows, threadsResult, openThreadsResult] =
        await Promise.all([
        getAgent(agentId),
        listProjects(),
        listAgentPassports()
          .then((r) => r.items)
          .catch(() => [] as AgentPassport[]),
        listTimeItems({
          from: new Date(Date.now() - 60_000).toISOString(),
          to: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          agentId,
          sources: ['wake', 'checkup', 'task'],
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
      let moreRuns = false
      try {
        runRows = await listWorkLogs({ agent_id: agentId, limit: 50 })
        moreRuns = runRows.length === 50
      } catch {
        const all = await listWorkLogs({ limit: 100 })
        runRows = all.filter((r) => r.agent_id === agentId)
      }
      const found = foundAgent
      setAgent(found)
      if (found) seedAgentPresence([found])
      setPassport(passportRows.find((p) => p.id === agentId) ?? null)
      setRuns(runRows)
      setRunsMore(moreRuns)
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
      setRunsMore(false)
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

  const loadMoreRuns = useCallback(async () => {
    if (!agentId || loadingMoreRuns) return
    setLoadingMoreRuns(true)
    try {
      const page = await listWorkLogs({ agent_id: agentId, limit: 50, offset: runs.length })
      setRuns((prev) => {
        const seen = new Set(prev.map((row) => row.id))
        return [...prev, ...page.filter((row) => !seen.has(row.id))]
      })
      setRunsMore(page.length === 50)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('workforce.agents.detailLoadError'))
    } finally {
      setLoadingMoreRuns(false)
    }
  }, [agentId, loadingMoreRuns, runs.length, t])

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
  const heroOrb = useAgentOrbDrive(agentId, presenceOrbMotion(work))
  const profileAccent = useMemo(
    () => agentProfileAccentColor(resolveAgentAvatarColor(agent?.avatar_color)),
    [agent?.avatar_color],
  )
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
          className="inline-flex items-center gap-1 text-xs font-medium text-text-muted transition-colors hover:text-text-heading"
        >
          <ArrowLeft size={14} aria-hidden />
          {t('workforce.agents.backToAgent')}
        </Link>
        <LiveWorkLog workLogId={workLogId} />
      </PageContent>
    )
  }

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      <Link
        to={AGENTS_DEFAULT_PATH}
        className="inline-flex items-center gap-1 text-xs font-medium text-text-muted transition-colors hover:text-text-heading"
      >
        <ArrowLeft size={14} aria-hidden />
        {t('workforce.agents.backToList')}
      </Link>

      {loading ? (
        <AgentIdentitySkeleton />
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
          <PageHeader className="sr-only" title={agent.name} />
          <section className="relative py-4">
            <div className="absolute right-0 top-0 z-[1] flex h-8 items-center gap-2">
              <OpenInGridButton kind="agent" id={agent.id} />
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="px-0 text-text-muted"
                aria-label={t('workforce.agents.openSettings')}
                onClick={() => setSettingsOpen(true)}
              >
                <Settings size={16} aria-hidden />
              </Button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    className="px-0 text-text-muted"
                    aria-label={t('workforce.agents.moreActions')}
                  >
                    <MoreHorizontal size={16} aria-hidden />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={4}
                    className="z-50 min-w-[180px] rounded-lg border border-border bg-bg-surface p-1 shadow-overlay"
                  >
                    <DropdownMenu.Item
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text-primary outline-none data-[highlighted]:bg-bg-hover"
                      onSelect={() => setHistoryOpen(true)}
                    >
                      <History size={14} />
                      {t('workforce.agents.historyMenu')}
                    </DropdownMenu.Item>
                    {isAdmin ? (
                      <>
                      <DropdownMenu.Separator className="my-1 h-px bg-border/60" />
                      {agent.kind !== 'personal' ? (
                        <DropdownMenu.Item
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text-primary outline-none data-[highlighted]:bg-bg-hover"
                          onSelect={() => setIdentityOpen(true)}
                        >
                          <Pencil size={14} />
                          {t('workforce.agents.editIdentity')}
                        </DropdownMenu.Item>
                      ) : null}
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
                      </>
                    ) : null}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>

            <div className="flex flex-col items-center text-center">
              <div
                className="relative shrink-0"
                style={{ width: HERO_MARK_SIZE, height: HERO_MARK_SIZE }}
              >
                {isAdmin && agent.kind !== 'personal' ? (
                  <Pressable
                    onClick={() => setIdentityOpen(true)}
                    className="w-auto text-center group relative z-[1] overflow-visible focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                    style={{ width: HERO_MARK_SIZE, height: HERO_MARK_SIZE }}
                    aria-label={t('workforce.agents.editIdentity')}
                  >
                    <Avatar
                      kind="agent"
                      agent={agent}
                      size={HERO_MARK_SIZE}
                      className="overflow-visible"
                      decorative
                      mode="live"
                      motion={heroOrb.motion}
                      pulseId={heroOrb.pulseId}
                      baseMotion={heroOrb.baseMotion}
                    />
                    <span
                      className="pointer-events-none absolute right-0 top-0 inline-flex h-8 w-8 translate-x-1/4 -translate-y-1/4 items-center justify-center rounded-full border border-border bg-bg-surface text-text-heading opacity-0 shadow-md ring-2 ring-bg-surface transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                      aria-hidden
                    >
                      <Pencil size={14} />
                    </span>
                  </Pressable>
                ) : (
                  <Avatar
                    kind="agent"
                    agent={agent}
                    size={HERO_MARK_SIZE}
                    className="relative z-[1]"
                    decorative
                    mode="live"
                    motion={heroOrb.motion}
                    pulseId={heroOrb.pulseId}
                    baseMotion={heroOrb.baseMotion}
                  />
                )}
              </div>

              <div className="mt-4 flex min-w-0 max-w-xl flex-col items-center">
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <NameEdit
                    value={agent.name}
                    canEdit={isAdmin && agent.kind !== 'personal'}
                    heading="h2"
                    size="2xl"
                    label={t('workforce.agents.editIdentity')}
                    onStart={() => setIdentityOpen(true)}
                  />
                </div>
                {agent.job_title ? (
                  <p
                    className="mt-1.5 text-base font-medium leading-snug"
                    style={{ color: profileAccent }}
                  >
                    {agent.job_title}
                  </p>
                ) : isAdmin && agent.kind !== 'personal' ? (
                  <TextLink tone="muted"
                    onClick={() => setIdentityOpen(true)}
                    className="text-sm mt-1.5"
                  >
                    {t('workforce.agents.profileAddJobTitle')}
                  </TextLink>
                ) : null}
                {agent.description ? (
                  <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-text-secondary">
                    {agent.description}
                  </p>
                ) : isAdmin && agent.kind !== 'personal' ? (
                  <TextLink tone="muted"
                    onClick={() => setIdentityOpen(true)}
                    className="text-sm mt-1"
                  >
                    {t('workforce.agents.profileAddDescription')}
                  </TextLink>
                ) : null}
                <AgentModuleOrigin agent={agent} linked />
                {work === 'working' && (view?.current_activity_summary || live?.summary) ? (
                  workHref ? (
                    <Link
                      to={workHref}
                      className="mt-1 text-sm text-text-secondary hover:text-text-heading"
                    >
                      {view?.current_activity_summary || live?.summary}
                    </Link>
                  ) : (
                    <p className="mt-1 text-sm text-text-secondary">
                      {view?.current_activity_summary || live?.summary}
                    </p>
                  )
                ) : null}
                {workHref ? (
                  <Link
                    to={workHref}
                    className="mt-1 text-xs font-medium text-accent hover:underline"
                  >
                    {t('workforce.agents.openCurrentWork')}
                  </Link>
                ) : null}
              </div>

              {agent.is_active === false ? (
                <div className="mt-4 flex w-full max-w-lg flex-wrap items-center justify-center gap-2 rounded-lg border border-border bg-bg-elevated px-3 py-2">
                  <p className="text-sm text-text-secondary">
                    {t('workforce.agents.deactivatedBanner')}
                  </p>
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
                <p className="mt-3 text-sm text-text-muted">
                  <Link
                    to={`/folders/${linkedProject.id}`}
                    className="font-medium text-accent hover:underline"
                  >
                    {t('workforce.agents.projectLink', { name: linkedProject.name })}
                  </Link>
                </p>
              ) : null}
              {!isAdmin ? (
                <p className="mt-3 text-xs text-text-muted">
                  {t('workforce.agents.readonlyBanner')}
                </p>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                {agent.kind !== 'personal' && agent.is_active !== false ? (
                  <Button type="button" size="sm" variant="secondary" asChild>
                    <Link
                      to={withNavReveal(
                        newConversationPath({ intent: 'agent', agentId: agent.id }),
                      )}
                    >
                      <MessageSquare size={14} className="mr-1.5" aria-hidden />
                      {t('workforce.agents.chatWith')}
                    </Link>
                  </Button>
                ) : null}
                <Link
                  to={`/agenda?agent=${agent.id}`}
                  className="inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-text-muted transition-colors hover:bg-bg-hover hover:text-text-heading"
                >
                  {t('workforce.agents.openAgenda')}
                </Link>
                <Link
                  to={withNavReveal(agentChatPath(agent.id, { queue: 'open' }))}
                  className="inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-text-muted transition-colors hover:bg-bg-hover hover:text-text-heading"
                >
                  {t('workforce.agents.openThreads')}
                </Link>
              </div>
            </div>

            {archiveConfirmOpen && agent.is_active !== false ? (
              <div className="mx-auto mt-4 max-w-lg rounded-lg border border-status-error/30 bg-status-error/5 px-3 py-2 text-center">
                <p className="text-sm text-text-heading">
                  {agent.affiliated || agent.managed
                    ? t('workforce.agents.archiveConfirmAffiliated', {
                        place:
                          agent.affiliation_label ||
                          agent.department_name ||
                          agent.module_name ||
                          agent.origin_label ||
                          t('workforce.agents.affiliationBadgeFallback'),
                      })
                    : t('workforce.agents.archiveConfirm')}
                </p>
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setArchiveConfirmOpen(false)}>
                    {t('workforce.agents.archiveCancel')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="text-status-error hover:text-status-error"
                    disabled={archiveBusy}
                    onClick={() => void handleArchive()}
                  >
                    {t('workforce.agents.archiveConfirmAction')}
                  </Button>
                </div>
              </div>
            ) : null}
            {actionError ? (
              <p className="mt-2 text-center text-sm text-status-error">{actionError}</p>
            ) : null}
          </section>
          <NewAgentDialog
            open={duplicateOpen}
            onOpenChange={setDuplicateOpen}
            onCreated={(agentId) => navigate(`/agents/${agentId}`)}
            prefill={{
              name: t('workforce.agents.duplicateName', { name: agent.name }),
              model: agent.model ?? undefined,
              jobTitle: agent.job_title ?? undefined,
              description: agent.description ?? undefined,
              purpose: agent.purpose ?? agent.system_prompt ?? undefined,
            }}
          />

          {agent.kind !== 'personal' ? (
            <AgentIdentityDialog
              open={identityOpen}
              onOpenChange={setIdentityOpen}
              agentId={agent.id}
              agentName={agent.name}
              agentJobTitle={agent.job_title}
              agentDescription={agent.description}
              avatarKind={agent.avatar_kind}
              avatarIcon={agent.avatar_icon}
              avatarColor={agent.avatar_color}
              avatarShape={agent.avatar_shape}
              callVoice={agent.call_voice}
              callSpeed={agent.call_speed}
              callLanguage={agent.call_language}
              callVoices={agent.call_voices}
              callSpeeds={agent.call_speeds}
              callLanguages={agent.call_languages}
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
                          className="flex items-center gap-3 rounded-md border border-transparent px-3 py-2 text-sm transition-colors hover:bg-bg-hover"
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
                  <div className="mt-3 border-t border-border pt-3">
                    <Button type="button" size="sm" variant="secondary" className="w-full" asChild>
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
                  <div className="mt-auto border-t border-border pt-3">
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="secondary" className="flex-1" asChild>
                        <Link to={`/agenda?agent=${agent.id}&new=once`}>
                          {t('workforce.agents.scheduleOnAgenda')}
                        </Link>
                      </Button>
                      <Button type="button" size="sm" variant="ghost" asChild>
                        <Link to={TAB_PATHS.agenda}>
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
                          className="flex items-center gap-3 rounded-md border border-transparent px-3 py-2 text-sm transition-colors hover:bg-bg-hover"
                        >
                          <CalendarDays size={14} className="shrink-0 text-text-muted" aria-hidden />
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
                  <div className="mt-3 border-t border-border pt-3">
                    <Button type="button" size="sm" variant="secondary" className="w-full" asChild>
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

          <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
            <DialogContent className="max-h-[min(880px,92vh)] w-[calc(100%-2rem)] max-w-3xl gap-0 overflow-hidden p-0">
              <DialogHeader className="border-b border-border px-5 py-4 pr-14 text-left">
                <DialogTitle>{t('workforce.agents.settingsTitle')}</DialogTitle>
                <DialogDescription>{t('workforce.agents.settingsHint')}</DialogDescription>
              </DialogHeader>
              <div className="max-h-[min(760px,calc(92vh-5.5rem))] space-y-4 overflow-y-auto px-5 py-4">
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
                  <Card className="px-4 py-3" data-testid="agent-wake">
                    <h3 className="mb-3 text-base font-semibold text-text-heading">{t('departmentPage.awareness.mode')}</h3>
                    {awareness ? (
                      <AwarenessEditor
                        awareness={awareness}
                        canEdit={isAdmin}
                        onSave={async (patch) => {
                          if (!token) return
                          const next = await patchAgentAwareness(token, agent.id, patch)
                          setAwareness(next)
                        }}
                      />
                    ) : (
                      <p className="text-sm text-text-muted">{t('departmentPage.none')}</p>
                    )}
                  </Card>
                ) : null}
                <AgentModelCard
                  agentId={agent.id}
                  currentModel={agent.model}
                  canEdit={isAdmin}
                  onChanged={() => void load()}
                />
                {agent.kind !== 'personal' ? (
                  <AgentRulesEditor agentId={agent.id} canEdit canGrant={isAdmin} />
                ) : null}
                {agent.kind !== 'personal' ? (
                  <AgentDefinitionCard agentId={agent.id} canEdit={isAdmin} />
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
                {agent.kind !== 'personal' ? <AgentChatAccessCard agentId={agent.id} /> : null}
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
                    <Button type="button" size="sm" variant="secondary" asChild>
                      <Link to="/settings/govern?tab=policy">
                        <ShieldCheck size={14} className="mr-1.5" aria-hidden />
                        {t('workforce.agents.editPolicies')}
                      </Link>
                    </Button>
                  </div>
                  <div className="mt-3">
                    <AgentToolsPicker
                      agentId={agent.id}
                      allowedTools={passport?.tools ?? []}
                      canEdit={isAdmin}
                      onSaved={(tools) =>
                        setPassport((prev) => (prev ? { ...prev, tools } : prev))
                      }
                    />
                  </div>
                </Card>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
            <DialogContent className="max-h-[min(880px,92vh)] w-[calc(100%-2rem)] max-w-4xl gap-0 overflow-hidden p-0">
              <DialogHeader className="border-b border-border px-5 py-4 pr-14 text-left">
                <DialogTitle>{t('workforce.agents.historyMenu')}</DialogTitle>
                <DialogDescription>{t('workforce.agents.historyHint')}</DialogDescription>
              </DialogHeader>
              <div className="max-h-[min(760px,calc(92vh-5.5rem))] space-y-6 overflow-y-auto px-5 py-4">
                <AgentActivityTimeline agentId={agent.id} />
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
                      <Link
                        to={withNavReveal(
                          newConversationPath({ intent: 'agent', agentId: agent.id }),
                        )}
                      >
                        {t('workforce.agents.chatWith')}
                      </Link>
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
            {runsMore ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={loadingMoreRuns}
                onClick={() => void loadMoreRuns()}
              >
                {loadingMoreRuns ? t('workforce.agents.loadingMoreRuns') : t('workforce.agents.loadMoreRuns')}
              </Button>
            ) : null}
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <PageRelatedLinks
            links={[
              { to: AUTONOMY_PATH, label: t('workforce.agents.relatedInboxAi') },
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
