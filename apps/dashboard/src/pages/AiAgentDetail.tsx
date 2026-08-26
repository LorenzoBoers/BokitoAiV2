import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { Archive, CalendarDays, Crown, MessageSquare, Network, Pause, Play, Settings, ShieldCheck } from 'lucide-react'
import { LiveWorkLog } from '../components/observability/LiveWorkLog'
import { WorkLogsTable } from '../components/workforce/WorkLogsTable'
import { AgentChatAccessCard } from '../components/workforce/AgentChatAccessCard'
import { AgentModelCard } from '../components/workforce/AgentModelCard'
import { AgentToolsPicker } from '../components/workforce/AgentToolsPicker'
import { AgentInstructionsCard } from '../components/workforce/AgentInstructionsCard'
import { AgentSignatureCard } from '../components/workforce/AgentSignatureCard'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { LoadingBlock } from '../components/ui/loading-block'
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
import { formatAppWeekdayDateTime } from '../lib/app-locale'
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

const STATUS_CLASS: Record<RuntimeAgent['status'], string> = {
  active: 'text-status-success',
  standby: 'text-text-muted',
  sleeping: 'text-text-muted',
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
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [leadBusy, setLeadBusy] = useState(false)
  const [autonomyBusy, setAutonomyBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!agentId || workLogId) return
    setLoading(true)
    setError(null)
    try {
      const [agentRows, projectRows, passportRows, agendaRows, triggerRows, threadsResult] = await Promise.all([
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
          .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
          .slice(0, 5),
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
      const next = agent.status === 'active' ? 'standby' : 'active'
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
    const confirmed = window.confirm(t('workforce.agents.archiveConfirm'))
    if (!confirmed) return
    setArchiveBusy(true)
    setActionError(null)
    try {
      await archiveAgent(undefined, agent.id)
      navigate(AGENTS_DEFAULT_PATH, { replace: true })
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('workforce.agents.archiveError'))
      setArchiveBusy(false)
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

  if (!isAdmin) {
    return <Navigate to={inboxPath('all')} replace />
  }

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
        <LoadingBlock label={t('workforce.agents.loading')} />
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
                <AiAvatar name={agent.name} seed={agent.id} size={34} className="mt-0.5" />
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
                  </div>
                  <p className="mt-0.5 text-sm text-text-muted">
                    {agentRoleLabel(agent.role_name || agent.role_slug, t)}
                  </p>
                </div>
              </div>
              <span
                className={cn('text-sm font-medium capitalize', STATUS_CLASS[agent.status])}
              >
                {t(`workforce.agents.status.${agent.status}`)}
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
            <div className="mt-3 flex flex-wrap gap-2">
              {agent.kind !== 'personal' ? (
                <Button type="button" size="sm" variant="outline" asChild>
                  <Link to={agentChatPath(agent.id)}>
                    <MessageSquare size={14} className="mr-1.5" aria-hidden />
                    {t('workforce.agents.chatWith')}
                  </Link>
                </Button>
              ) : null}
              {(agent.role_slug === 'orchestrator' || agent.role_slug === 'po' || agent.role_slug === 'orchestra') ? (
                <Button type="button" size="sm" variant="outline" asChild>
                  <Link to="/settings/govern?tab=policy">
                    <ShieldCheck size={14} className="mr-1.5" aria-hidden />
                    {t('workforce.agents.openGovern')}
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
              <Button type="button" size="sm" variant="outline" asChild>
                <Link to="/knowledge">
                  <Network size={14} className="mr-1.5" aria-hidden />
                  {t('workforce.agents.openKnowledge')}
                </Link>
              </Button>
              <Button type="button" size="sm" variant="outline" asChild>
                <Link to="/settings/communication">
                  <Settings size={14} className="mr-1.5" aria-hidden />
                  {t('workforce.agents.openInboxAi')}
                </Link>
              </Button>
              <Button type="button" size="sm" variant="outline" asChild>
                <Link to="/settings/setup">
                  {t('workforce.agents.openSetup')}
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
                  {agent.status === 'active' ? (
                    <Pause size={14} className="mr-1.5" aria-hidden />
                  ) : (
                    <Play size={14} className="mr-1.5" aria-hidden />
                  )}
                  {agent.status === 'active'
                    ? t('workforce.agents.pause')
                    : t('workforce.agents.wake')}
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
              {isAdmin && !agent.is_lead ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={archiveBusy}
                  className="text-status-error hover:text-status-error"
                  onClick={() => void handleArchive()}
                >
                  <Archive size={14} className="mr-1.5" aria-hidden />
                  {t('workforce.agents.archive')}
                </Button>
              ) : null}
              {isAdmin && agent.is_lead ? (
                <span className="self-center text-xs text-text-muted">
                  {t('workforce.agents.leadArchiveBlocked')}
                </span>
              ) : null}
            </div>
            {actionError ? <p className="mt-2 text-sm text-status-error">{actionError}</p> : null}
          </Card>

          {agendaItems.length > 0 ? (
            <Card className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-text-heading">
                    {t('workforce.agents.agendaTitle')}
                  </h3>
                  <p className="text-sm text-text-muted">
                    {t('workforce.agents.agendaDescription')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" asChild>
                    <Link to={`/agenda?agent=${agent.id}`}>
                      {t('workforce.agents.openFullAgenda')}
                    </Link>
                  </Button>
                  <Button type="button" size="sm" variant="ghost" asChild>
                    <Link to={AGENDA_AUTOMATIONS_PATH}>
                      {t('workforce.agents.openAgendaAutomations')}
                    </Link>
                  </Button>
                </div>
              </div>
              <div className="mt-3 space-y-1.5">
                {agendaItems.map((item) => {
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
            </Card>
          ) : agent && !loading ? (
            <Card className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-text-heading">
                    {t('workforce.agents.agendaTitle')}
                  </h3>
                  <p className="mt-1 text-sm text-text-muted">{t('workforce.agents.agendaEmptyHint')}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" asChild>
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
            </Card>
          ) : null}

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
              signatureHtml={agent.email_signature_html ?? ''}
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
                      <Link to={inboxPath('open')}>{t('workforce.agents.openCommunication')}</Link>
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
