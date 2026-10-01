import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CircleDollarSign, GitPullRequest, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { CockpitPanelsSkeleton } from '../ui/skeleton'
import { listCases, listCaseTypes, type CaseRow, type CaseTypeRow } from '../../lib/cases-api'
import { listGovernChanges, type PlatformChangeRow } from '../../lib/govern-api'
import { listThreads, type InboxThread } from '../../lib/inbox-api'
import { attentionThreadPath, decisionsPath, inboxPath } from '../../lib/messages-paths'
import { listWorkLogs, type WorkLogRow } from '../../lib/work-logs-api'
import { listWorkstreamRuns, type WorkstreamRunRow } from '../../lib/workstreams-api'
import { workstreamRunPath } from '../../lib/workstream-ui'
import { agentWorkforceRunUrl } from '../../lib/workforce-run-urls'
import { bokitoGetUsageBreakdown, type UsageBreakdown } from '../../lib/bokito-api'
import { formatAppUsdCents } from '../../lib/app-number'

type SignalTypeSummary = {
  type: CaseTypeRow
  open: number
  waiting: number
}

type OverviewData = {
  needsYou: InboxThread[]
  cases: CaseRow[]
  types: CaseTypeRow[]
  playbookRuns: WorkstreamRunRow[]
  jobs: WorkLogRow[]
  govern: PlatformChangeRow[]
  usage: UsageBreakdown | null
}

const EMPTY: OverviewData = {
  needsYou: [],
  cases: [],
  types: [],
  playbookRuns: [],
  jobs: [],
  govern: [],
  usage: null,
}

function startOfWeek(offset = 0): Date {
  const now = new Date()
  const day = (now.getDay() + 6) % 7
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - day + offset * 7)
  return date
}

function inRange(value: string | null | undefined, from: Date, to: Date): boolean {
  if (!value) return false
  const timestamp = new Date(value).getTime()
  return timestamp >= from.getTime() && timestamp < to.getTime()
}

function delta(current: number, previous: number): string {
  const value = current - previous
  return value > 0 ? `+${value}` : String(value)
}

function Block({
  title,
  hint,
  children,
  index = 0,
}: {
  title: string
  hint: string
  children: ReactNode
  index?: number
}) {
  return (
    <section
      className="stagger-in rounded-lg border border-border/60 bg-bg-surface p-4"
      style={{ '--stagger': index } as CSSProperties}
    >
      <div>
        <h2 className="text-base font-semibold text-text-heading">{title}</h2>
        <p className="mt-0.5 text-xs text-text-muted">{hint}</p>
      </div>
      <div className="mt-3 space-y-1.5">{children}</div>
    </section>
  )
}

function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <div className="animate-fade-in rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-xs text-text-muted">
      {children}
    </div>
  )
}

function Metric({
  label,
  value,
  detail,
  to,
}: {
  label: string
  value: string
  detail: string
  to: string
}) {
  return (
    <Link
      to={to}
      className="row-interactive group flex items-center gap-3 rounded-md border border-transparent px-3 py-2.5 transition-colors hover:bg-bg-hover/70"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-text-primary">{label}</span>
        <span className="block truncate-fade text-xs text-text-muted">{detail}</span>
      </span>
      <span key={value} className="count-pop tabular-nums text-base font-semibold text-text-heading">
        {value}
      </span>
      <ArrowRight
        size={12}
        className="text-text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent"
      />
    </Link>
  )
}

export default function OverviewFourBlocks() {
  const { token } = useAuth()
  const { i18n } = useTranslation()
  const nl = i18n.language.toLowerCase().startsWith('nl')
  const copy = nl
    ? {
        needs: 'Jij bent nodig',
        needsHint: 'Open beslissingen en gesprekken die aan jou zijn toegewezen.',
        signals: 'Open signalen per type',
        signalsHint: 'Open en wachtend werk. Open een rij om Communicatie te filteren.',
        running: 'Lopend',
        runningHint: 'Draaiboekruns en workbench-taken die nu bezig zijn.',
        trajectory: 'Traject',
        trajectoryHint: 'Deze week, met het verschil ten opzichte van vorige week.',
        emptyNeeds: 'Niets wacht op jou.',
        emptySignals: 'Geen open signalen.',
        emptyRunning: 'Er draait nu niets.',
        decisions: 'Beslissing nodig',
        assigned: 'Aan jou toegewezen',
        open: 'Open',
        waiting: 'Wachtend',
        playbook: 'Draaiboek',
        workbench: 'Workbench',
        autoSignals: 'Automatisch vastgelegde signalen',
        handSignals: 'Handmatig vastgelegde signalen',
        finishedRuns: 'Runs afgerond zonder beslissing',
        governWaiting: 'Voorstellen wachten in Govern',
        cost: 'Kosten per signaaltype',
        costUnavailable: 'Nog niet toewijsbaar; workbench-gebruik mist een signaaltype.',
        loadError: 'Een deel van Overview kon niet worden geladen.',
      }
    : {
        needs: 'Needs you',
        needsHint: 'Open decisions and conversations assigned to you.',
        signals: 'Open signals by type',
        signalsHint: 'Open and waiting work. Open a row to filter Communication.',
        running: 'Running',
        runningHint: 'Playbook runs and workbench jobs currently in progress.',
        trajectory: 'Trajectory',
        trajectoryHint: 'This week, with the change from last week.',
        emptyNeeds: 'Nothing is waiting on you.',
        emptySignals: 'No open signals.',
        emptyRunning: 'Nothing is running.',
        decisions: 'Decision needed',
        assigned: 'Assigned to you',
        open: 'Open',
        waiting: 'Waiting',
        playbook: 'Playbook',
        workbench: 'Workbench',
        autoSignals: 'Signals filed automatically',
        handSignals: 'Signals filed by hand',
        finishedRuns: 'Runs finished without a decision',
        governWaiting: 'Proposals waiting in Govern',
        cost: 'Cost per signal type',
        costUnavailable: 'Not attributable yet; workbench usage has no signal type.',
        loadError: 'Some Overview data could not be loaded.',
      }
  const [data, setData] = useState<OverviewData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(false)
    const settled = await Promise.allSettled([
      Promise.all([
        listThreads(token, { view: 'awaiting_decision', perPage: 10 }),
        listThreads(token, { view: 'mine', perPage: 10 }),
      ]),
      listCases({ includeLabels: false, limit: 500 }),
      listCaseTypes(),
      listWorkstreamRuns({ limit: 100 }),
      listWorkLogs({ status: 'running', limit: 100 }),
      listGovernChanges('pending_review').then((value) => value.items ?? []),
      bokitoGetUsageBreakdown(token, 7),
    ])
    const value = <T,>(index: number, fallback: T): T =>
      settled[index]?.status === 'fulfilled' ? (settled[index] as PromiseFulfilledResult<T>).value : fallback
    const threadGroups = value(0, [] as Awaited<ReturnType<typeof listThreads>>[])
    const uniqueThreads = new Map<string, InboxThread>()
    for (const group of threadGroups) {
      for (const thread of group.items) {
        if (thread.channel !== 'assistant') uniqueThreads.set(String(thread.id), thread)
      }
    }
    setData({
      needsYou: [...uniqueThreads.values()]
        .sort((a, b) => new Date(b.lastMessageAt ?? b.createdAt).getTime() - new Date(a.lastMessageAt ?? a.createdAt).getTime())
        .slice(0, 5),
      cases: value(1, [] as CaseRow[]),
      types: value(2, [] as CaseTypeRow[]),
      playbookRuns: value(3, [] as WorkstreamRunRow[]),
      jobs: value(4, [] as WorkLogRow[]),
      govern: value(5, [] as PlatformChangeRow[]),
      usage: value(6, null as UsageBreakdown | null),
    })
    setError(settled.some((result) => result.status === 'rejected'))
    setLoading(false)
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const signalTypes = useMemo<SignalTypeSummary[]>(() => {
    const byType = new Map(data.types.map((type) => [type.id, { type, open: 0, waiting: 0 }]))
    for (const item of data.cases) {
      const row = byType.get(item.case_type_id)
      if (!row) continue
      if (item.status === 'open' || item.status === 'proposed') row.open += 1
      if (item.status === 'waiting') row.waiting += 1
    }
    return [...byType.values()].filter((row) => row.open + row.waiting > 0).sort((a, b) => b.open + b.waiting - a.open - a.waiting)
  }, [data.cases, data.types])

  const running = useMemo(() => {
    const playbooks = data.playbookRuns
      .filter((run) => run.status === 'running' || run.status === 'waiting' || run.status === 'awaiting_gate')
      .map((run) => ({
        id: `playbook-${run.id}`,
        label: run.workstream_name || run.input_text || copy.playbook,
        detail: `${copy.playbook} · ${run.status}`,
        to: workstreamRunPath(run.id),
        at: run.updated_at || run.started_at || '',
      }))
    const jobs = data.jobs
      .filter((job) => job.status === 'running')
      .map((job) => ({
        id: `job-${job.id}`,
        label: job.task_subject || copy.workbench,
        detail: copy.workbench,
        to: job.agent_id ? agentWorkforceRunUrl(job.agent_id, job.id) : '/activity',
        at: typeof job.started_at === 'string' ? job.started_at : '',
      }))
    return [...playbooks, ...jobs].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 5)
  }, [data.jobs, data.playbookRuns, copy.playbook, copy.workbench])

  const trajectory = useMemo(() => {
    const thisWeek = startOfWeek()
    const nextWeek = startOfWeek(1)
    const lastWeek = startOfWeek(-1)
    const cases = (from: Date, to: Date) => data.cases.filter((item) => inRange(item.created_at, from, to))
    const currentCases = cases(thisWeek, nextWeek)
    const previousCases = cases(lastWeek, thisWeek)
    const isAuto = (item: CaseRow) => item.case_type?.create_mode === 'auto'
    const completed = (from: Date, to: Date) =>
      data.playbookRuns.filter((run) => run.status === 'completed' && inRange(run.completed_at, from, to)).length
    return {
      auto: [currentCases.filter(isAuto).length, previousCases.filter(isAuto).length],
      hand: [currentCases.filter((item) => !isAuto(item)).length, previousCases.filter((item) => !isAuto(item)).length],
      completed: [completed(thisWeek, nextWeek), completed(lastWeek, thisWeek)],
    }
  }, [data.cases, data.playbookRuns])

  const trajectoryRows = [
    { label: copy.autoSignals, values: trajectory.auto, to: '/settings/signals?origin=auto' },
    { label: copy.handSignals, values: trajectory.hand, to: '/settings/signals?origin=manual' },
    { label: copy.finishedRuns, values: trajectory.completed, to: '/workstreams?view=runs&status=completed' },
  ] as const

  if (loading) {
    return (
      <div className="space-y-4">
        <CockpitPanelsSkeleton />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-right text-xs text-status-warning">{copy.loadError}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Block title={copy.needs} hint={copy.needsHint} index={0}>
          {data.needsYou.length === 0 ? <EmptyRow>{copy.emptyNeeds}</EmptyRow> : data.needsYou.map((thread) => (
            <Link
              key={String(thread.id)}
              to={attentionThreadPath(thread)}
              className="row-interactive group flex items-center gap-3 rounded-md border border-transparent px-3 py-2.5 transition-colors hover:bg-bg-hover/70"
            >
              {thread.hasOpenDecision ? (
                <span className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-status-warning" />
              ) : (
                <GitPullRequest size={13} className="shrink-0 text-text-muted" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate-fade text-sm font-medium text-text-primary">{thread.emailSubject || thread.contactName}</span>
                <span className="block truncate-fade text-xs text-text-muted">{thread.hasOpenDecision ? copy.decisions : copy.assigned}</span>
              </span>
              <ArrowRight
                size={12}
                className="shrink-0 text-text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent"
              />
            </Link>
          ))}
          <Link to={data.needsYou.some((thread) => thread.hasOpenDecision) ? decisionsPath() : inboxPath('mine')} className="link-draw block pt-1 text-right text-xs font-medium text-accent">
            {nl ? 'Alles openen' : 'Open all'}
          </Link>
        </Block>

        <Block title={copy.signals} hint={copy.signalsHint} index={1}>
          {signalTypes.length === 0 ? <EmptyRow>{copy.emptySignals}</EmptyRow> : signalTypes.map((row) => (
            <Metric
              key={row.type.id}
              label={row.type.name}
              value={String(row.open + row.waiting)}
              detail={`${copy.open} ${row.open} · ${copy.waiting} ${row.waiting}`}
              to={`/communication/inbox/open?case_type_id=${encodeURIComponent(row.type.id)}`}
            />
          ))}
        </Block>

        <Block title={copy.running} hint={copy.runningHint} index={2}>
          {running.length === 0 ? <EmptyRow>{copy.emptyRunning}</EmptyRow> : running.map((row) => (
            <Link
              key={row.id}
              to={row.to}
              className="row-interactive group flex items-center gap-3 rounded-md border border-transparent px-3 py-2.5 transition-colors hover:bg-bg-hover/70"
            >
              <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                <span className="pulse-dot absolute h-1.5 w-1.5 rounded-full bg-accent" />
                <Play size={13} className="relative text-accent opacity-90" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate-fade text-sm font-medium text-text-primary">{row.label}</span>
                <span className="block truncate-fade text-xs text-text-muted">{row.detail}</span>
              </span>
              <ArrowRight
                size={12}
                className="shrink-0 text-text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent"
              />
            </Link>
          ))}
        </Block>

        <Block title={copy.trajectory} hint={copy.trajectoryHint} index={3}>
          {trajectoryRows.map((row) => (
            <Metric
              key={row.label}
              label={row.label}
              value={String(row.values[0])}
              detail={`${nl ? 't.o.v. vorige week' : 'vs last week'} ${delta(row.values[0], row.values[1])}`}
              to={row.to}
            />
          ))}
          <Metric
            label={copy.governWaiting}
            value={String(data.govern.length)}
            detail={nl ? 'Open voorstellen' : 'Open proposals'}
            to="/settings/govern?tab=drafts"
          />
          <Link
            to="/cockpit/usage"
            className="row-interactive group flex items-center gap-3 rounded-md border border-transparent px-3 py-2.5 transition-colors hover:bg-bg-hover/70"
          >
            <CircleDollarSign size={13} className="shrink-0 text-text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-text-primary">{copy.cost}</span>
              <span className="block text-xs text-text-muted">{copy.costUnavailable}</span>
            </span>
            <span className="text-xs font-semibold text-text-heading">
              {data.usage ? formatAppUsdCents(data.usage.total_customer_cost_micros / 10_000, i18n.language) : '—'}
            </span>
            <ArrowRight
              size={12}
              className="shrink-0 text-text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent"
            />
          </Link>
        </Block>
      </div>
    </div>
  )
}
