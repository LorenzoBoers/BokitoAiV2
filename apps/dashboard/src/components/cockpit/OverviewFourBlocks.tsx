import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, CalendarClock, CircleDollarSign, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { CockpitPanelsSkeleton } from '../ui/skeleton'
import { listGovernChanges, type PlatformChangeRow } from '../../lib/govern-api'
import { listThreads, type InboxThread } from '../../lib/inbox-api'
import { attentionThreadPath, forYouPath, tagPath } from '../../lib/messages-paths'
import { withNavReveal } from '../../lib/nav-reveal'
import { listCategories, type CategoryRow } from '../../lib/tickets-api'
import { listWorkLogs, type WorkLogRow } from '../../lib/work-logs-api'
import { listWorkstreamRuns, type WorkstreamRunRow } from '../../lib/workstreams-api'
import { workstreamRunPath } from '../../lib/workstream-ui'
import { openEntityPath } from '../../lib/open-entity'
import { bokitoGetUsageBreakdown, type UsageBreakdown } from '../../lib/bokito-api'
import { formatAppUsdCents } from '../../lib/app-number'
import { formatAppTime } from '../../lib/app-locale'
import { attentionOf, layerOf } from '../../lib/agenda-layout'
import { agendaKindLabel } from '../../lib/status-labels'
import { agendaKindOf, listTimeItems, parseTimelineMs, timeItemHref, type TimeItem } from '../../lib/time-items'
import AiHandlingMetricsBlock from './AiHandlingMetricsBlock'
import ThreadListItem from '../inbox/ThreadListItem'

type OverviewData = {
  needsYou: InboxThread[]
  categories: CategoryRow[]
  playbookRuns: WorkstreamRunRow[]
  jobs: WorkLogRow[]
  govern: PlatformChangeRow[]
  usage: UsageBreakdown | null
  agenda: TimeItem[]
}

const EMPTY: OverviewData = {
  needsYou: [],
  categories: [],
  playbookRuns: [],
  jobs: [],
  govern: [],
  usage: null,
  agenda: [],
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
      className="panel stagger-in min-w-0 p-4"
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
        <span className="block truncate-fade text-sm font-medium text-text-primary">{label}</span>
        <span className="block truncate-fade text-xs text-text-muted">{detail}</span>
      </span>
      <span key={value} className="count-pop shrink-0 tabular-nums text-base font-semibold text-text-heading">
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
  const { i18n, t } = useTranslation('nav')
  const navigate = useNavigate()
  const nl = i18n.language.toLowerCase().startsWith('nl')
  const copy = nl
    ? {
        needs: 'Jij bent nodig',
        needsHint: 'Open beslissingen en gesprekken die aan jou zijn toegewezen.',
        signals: 'Open tickets per actietag',
        signalsHint: 'Open en wachtend werk. Open een rij om de actietag in Communicatie te openen.',
        running: 'Lopend en straks',
        runningHint: 'Wat nu draait, en wat de komende 24 uur op de agenda staat.',
        agendaDue: 'Nu aan de beurt op de agenda',
        agendaDueDetail: 'Check-ups en verlopen kijkmomenten',
        openAgenda: 'Agenda openen',
        trajectory: 'Traject',
        trajectoryHint: 'Deze week, met het verschil ten opzichte van vorige week.',
        emptyNeeds: 'Niets wacht op jou.',
        emptySignals: 'Geen open tickets.',
        emptyRunning: 'Er draait nu niets en er staat niets gepland.',
        decisions: 'Beslissing nodig',
        assigned: 'Aan jou toegewezen',
        open: 'Open',
        waiting: 'Wachtend',
        playbook: 'Flow',
        workbench: 'Workbench',
        filedTickets: 'Tickets vastgelegd (7 dagen)',
        proposedTickets: 'Voorstellen wachten op bevestiging',
        finishedRuns: 'Runs afgerond zonder beslissing',
        governWaiting: 'Voorstellen wachten in Govern',
        cost: 'Kosten per categorie',
        costUnavailable: 'Nog niet toewijsbaar; workbench-gebruik mist een categorie.',
        loadError: 'Een deel van Overview kon niet worden geladen.',
      }
    : {
        needs: 'Needs you',
        needsHint: 'Open decisions and conversations assigned to you.',
        signals: 'Open tickets by action tag',
        signalsHint: 'Open and waiting work. Open a row to see the action tag in Communication.',
        running: 'Running and next up',
        runningHint: 'What runs now, and what is on the agenda in the next 24 hours.',
        agendaDue: 'Due now on the agenda',
        agendaDueDetail: 'Check-ups and overdue look-ats',
        openAgenda: 'Open Agenda',
        trajectory: 'Trajectory',
        trajectoryHint: 'This week, with the change from last week.',
        emptyNeeds: 'Nothing is waiting on you.',
        emptySignals: 'No open tickets.',
        emptyRunning: 'Nothing is running or planned.',
        decisions: 'Decision needed',
        assigned: 'Assigned to you',
        open: 'Open',
        waiting: 'Waiting',
        playbook: 'Flow',
        workbench: 'Workbench',
        filedTickets: 'Tickets filed (7 days)',
        proposedTickets: 'Proposals waiting for a confirm',
        finishedRuns: 'Runs finished without a decision',
        governWaiting: 'Proposals waiting in Govern',
        cost: 'Cost per category',
        costUnavailable: 'Not attributable yet; workbench usage has no category.',
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
        listThreads(token, { view: 'for_you', perPage: 10 }),
      ]),
      listCategories(),
      listWorkstreamRuns({ limit: 100 }),
      listWorkLogs({ status: 'running', limit: 100 }),
      listGovernChanges('pending_review').then((value) => value.items ?? []),
      bokitoGetUsageBreakdown(token, 7),
      listTimeItems({
        from: new Date(Date.now() - 30 * 86_400_000).toISOString(),
        to: new Date(Date.now() + 86_400_000).toISOString(),
        sources: ['checkup', 'task', 'wake', 'calendar'],
      }).then((window) => window.items),
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
      categories: value(1, [] as CategoryRow[]),
      playbookRuns: value(2, [] as WorkstreamRunRow[]),
      jobs: value(3, [] as WorkLogRow[]),
      govern: value(4, [] as PlatformChangeRow[]),
      usage: value(5, null as UsageBreakdown | null),
      agenda: value(6, [] as TimeItem[]),
    })
    setError(settled.some((result) => result.status === 'rejected'))
    setLoading(false)
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const openCategories = useMemo(
    () =>
      data.categories
        .filter((row) => row.open + row.waiting > 0)
        .sort((a, b) => b.open + b.waiting - a.open - a.waiting),
    [data.categories],
  )

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
        to: openEntityPath({ type: 'run', id: job.id, agentId: job.agent_id }),
        at: typeof job.started_at === 'string' ? job.started_at : '',
      }))
    return [...playbooks, ...jobs].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 5)
  }, [data.jobs, data.playbookRuns, copy.playbook, copy.workbench])

  const agenda = useMemo(() => {
    const now = Date.now()
    const due = attentionOf(data.agenda, now)
    const upcoming = data.agenda
      .filter((item) => parseTimelineMs(item.start) > now && layerOf(item) === 'tasks')
      .sort((a, b) => parseTimelineMs(a.start) - parseTimelineMs(b.start))
      .slice(0, 3)
    return { due: due.tasks.length, upcoming }
  }, [data.agenda])

  const trajectory = useMemo(() => {
    const thisWeek = startOfWeek()
    const nextWeek = startOfWeek(1)
    const lastWeek = startOfWeek(-1)
    const sum = (pick: (row: CategoryRow) => number) => data.categories.reduce((total, row) => total + pick(row), 0)
    const completed = (from: Date, to: Date) =>
      data.playbookRuns.filter((run) => run.status === 'completed' && inRange(run.completed_at, from, to)).length
    return {
      filed: [sum((row) => row.filed_7d), sum((row) => row.filed_prev_7d)],
      completed: [completed(thisWeek, nextWeek), completed(lastWeek, thisWeek)],
    }
  }, [data.categories, data.playbookRuns])

  const proposedCount = data.categories.reduce((total, row) => total + row.proposed, 0)

  const trajectoryRows = [
    { label: copy.filedTickets, values: trajectory.filed, to: '/settings/action-tags' },
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

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Block title={copy.needs} hint={copy.needsHint} index={0}>
          {data.needsYou.length === 0 ? <EmptyRow>{copy.emptyNeeds}</EmptyRow> : data.needsYou.map((thread) => (
            <ThreadListItem
              key={String(thread.id)}
              thread={thread}
              isSelected={false}
              compact
              showActions={false}
              onSelect={() => navigate(attentionThreadPath(thread))}
            />
          ))}
          <Link to={forYouPath()} className="link-draw block pt-1 text-right text-xs font-medium text-accent">
            {nl ? 'Alles openen' : 'Open all'}
          </Link>
        </Block>

        <Block title={copy.signals} hint={copy.signalsHint} index={1}>
          {openCategories.length === 0 ? <EmptyRow>{copy.emptySignals}</EmptyRow> : openCategories.map((row) => (
            <Metric
              key={row.id}
              label={`#${row.name}`}
              value={String(row.open + row.waiting)}
              detail={`${copy.open} ${row.open} · ${copy.waiting} ${row.waiting}`}
              to={withNavReveal(tagPath(row.name, 'open'))}
            />
          ))}
          {proposedCount > 0 ? (
            <Metric
              label={copy.proposedTickets}
              value={String(proposedCount)}
              detail={nl ? 'Bevestig op het gesprek' : 'Confirm on the conversation'}
              to={forYouPath()}
            />
          ) : null}
        </Block>

        <Block title={copy.running} hint={copy.runningHint} index={2}>
          {agenda.due > 0 ? (
            <Link
              to="/agenda?view=list"
              className="row-interactive group flex items-center gap-3 rounded-md border border-status-warning/30 bg-status-warning/5 px-3 py-2.5 transition-colors hover:bg-status-warning/10"
            >
              <AlertTriangle size={13} className="shrink-0 text-status-warning" />
              <span className="min-w-0 flex-1">
                <span className="block truncate-fade text-sm font-medium text-text-primary">{copy.agendaDue}</span>
                <span className="block truncate-fade text-xs text-text-muted">{copy.agendaDueDetail}</span>
              </span>
              <span className="shrink-0 tabular-nums text-base font-semibold text-text-heading">{agenda.due}</span>
              <ArrowRight size={12} className="shrink-0 text-text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent" />
            </Link>
          ) : null}
          {running.length === 0 && agenda.upcoming.length === 0 && agenda.due === 0 ? <EmptyRow>{copy.emptyRunning}</EmptyRow> : null}
          {agenda.upcoming.map((item) => (
            <Link
              key={item.id}
              to={timeItemHref(item)}
              className="row-interactive group flex items-center gap-3 rounded-md border border-transparent px-3 py-2.5 transition-colors hover:bg-bg-hover/70"
            >
              <CalendarClock size={13} className="shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate-fade text-sm font-medium text-text-primary">{item.title}</span>
                <span className="block truncate-fade text-xs text-text-muted">
                  {formatAppTime(new Date(parseTimelineMs(item.start)), i18n.language)} · {agendaKindLabel(agendaKindOf(item), t)}
                </span>
              </span>
              <ArrowRight size={12} className="shrink-0 text-text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent" />
            </Link>
          ))}
          {running.map((row) => (
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
          <Link to="/agenda" className="link-draw block pt-1 text-right text-xs font-medium text-accent">
            {copy.openAgenda}
          </Link>
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

      <AiHandlingMetricsBlock />
    </div>
  )
}
