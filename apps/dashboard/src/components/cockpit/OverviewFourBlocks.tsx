import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, CalendarClock, CircleDollarSign, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { CockpitPanelsSkeleton } from '../ui/skeleton'
import { listGovernChanges, type PlatformChangeRow } from '../../lib/govern-api'
import { listThreads, type InboxThread } from '../../lib/inbox-api'
import { useOptionalNavBadges } from '../../context/NavBadgeContext'
import { pairForInboxQueue } from '../../lib/nav-badge-counts'
import { attentionThreadPath, forYouPath, tagPath } from '../../lib/messages-paths'
import { withNavReveal } from '../../lib/nav-reveal'
import { listCategories, type CategoryRow } from '../../lib/tickets-api'
import { listWorkLogs, type WorkLogRow } from '../../lib/work-logs-api'
import { listWorkstreamRuns, type WorkstreamRunRow } from '../../lib/flows-api'
import { workstreamPath } from '../../lib/workstream-ui'
import { openEntityPath } from '../../lib/open-entity'
import {
  bokitoGetCockpitSummary,
  bokitoGetUsageBreakdown,
  type CockpitImprovement,
  type TimeSavedAction,
  type UsageBreakdown,
} from '../../lib/bokito-api'
import { bulkUpdateSignalThreads } from '../../lib/signals-api'
import { Button } from '../ui/button'
import { Chart } from '../ui'
import { RecurringWakeBanner } from './RecurringWakeBanner'
import { formatAppUsdCents } from '../../lib/app-number'
import { formatAppTime } from '../../lib/app-locale'
import { attentionOf, layerOf } from '../../lib/agenda-layout'
import { agendaKindLabel } from '../../lib/status-labels'
import { agendaKindOf, listTimeItems, parseTimelineMs, timeItemHref, type TimeItem } from '../../lib/time-items'
import AiHandlingMetricsBlock from './AiHandlingMetricsBlock'
import ThreadListItem from '../inbox/ThreadListItem'

type QuietThread = {
  id: string
  subject: string
  contactName: string
  lastMessageAt: string | null
}

type OverviewData = {
  needsYou: InboxThread[]
  quiet: QuietThread[]
  improvements: CockpitImprovement[]
  categories: CategoryRow[]
  playbookRuns: WorkstreamRunRow[]
  jobs: WorkLogRow[]
  govern: PlatformChangeRow[]
  usage: UsageBreakdown | null
  timeSaved: TimeSavedAction[]
  agenda: TimeItem[]
}

const EMPTY: OverviewData = {
  needsYou: [],
  quiet: [],
  improvements: [],
  categories: [],
  playbookRuns: [],
  jobs: [],
  govern: [],
  usage: null,
  timeSaved: [],
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
      className="panel stagger-in min-w-0 overflow-hidden"
      style={{ '--stagger': index } as CSSProperties}
    >
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold text-text-heading">{title}</h2>
        <p className="mt-0.5 text-xs text-text-muted">{hint}</p>
      </div>
      <div className="space-y-1 p-3">{children}</div>
    </section>
  )
}

function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <div className="animate-fade-in rounded-lg border border-dashed border-border px-3 py-5 text-center text-xs text-text-muted">
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
        size={14}
        className="text-text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent"
      />
    </Link>
  )
}

export default function OverviewFourBlocks() {
  const { token } = useAuth()
  const { i18n, t } = useTranslation('nav')
  const navigate = useNavigate()
  const { counts } = useOptionalNavBadges()
  const forYouTotal = pairForInboxQueue(counts, 'for_you').total
  const copy = (key: string, options?: Record<string, unknown>) => t(`today.${key}`, options)
  const [data, setData] = useState<OverviewData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(false)
    const settled = await Promise.allSettled([
      listThreads(token, { view: 'for_you', perPage: 5 }),
      listCategories(),
      listWorkstreamRuns({ limit: 100 }),
      listWorkLogs({ status: 'running', limit: 100 }),
      listGovernChanges('pending_review').then((value) => value.items ?? []),
      bokitoGetUsageBreakdown(token, 7),
      bokitoGetCockpitSummary(token).catch(() => null),
      listTimeItems({
        from: new Date(Date.now() - 30 * 86_400_000).toISOString(),
        to: new Date(Date.now() + 86_400_000).toISOString(),
        sources: ['checkup', 'task', 'wake', 'calendar'],
      }).then((window) => window.items),
    ])
    const value = <T,>(index: number, fallback: T): T =>
      settled[index]?.status === 'fulfilled' ? (settled[index] as PromiseFulfilledResult<T>).value : fallback
    const summary = value(6, null as Awaited<ReturnType<typeof bokitoGetCockpitSummary>> | null)
    setData({
      needsYou: value(0, null as Awaited<ReturnType<typeof listThreads>> | null)?.items ?? [],
      improvements: summary?.improvements ?? [],
      categories: value(1, [] as CategoryRow[]),
      playbookRuns: value(2, [] as WorkstreamRunRow[]),
      jobs: value(3, [] as WorkLogRow[]),
      govern: value(4, [] as PlatformChangeRow[]),
      usage: value(5, null as UsageBreakdown | null),
      timeSaved: summary?.time_saved_breakdown ?? [],
      quiet: (value(6, null as Awaited<ReturnType<typeof bokitoGetCockpitSummary>> | null)?.quiet_threads ?? [])
        .slice(0, 5)
        .map((row) => ({
          id: row.id,
          subject: row.subject,
          contactName: row.contact_name,
          lastMessageAt: row.last_message_at,
        })),
      agenda: value(7, [] as TimeItem[]),
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
        label: run.workstream_name || run.input_text || copy('flow'),
        detail: `${copy('flow')} · ${run.status}`,
        to: run.workstream_id ? workstreamPath(run.workstream_id) : '/flows',
        at: run.updated_at || run.started_at || '',
      }))
    const jobs = data.jobs
      .filter((job) => job.status === 'running')
      .map((job) => ({
        id: `job-${job.id}`,
        label: job.task_subject || copy('workbench'),
        detail: copy('workbench'),
        to: openEntityPath({ type: 'run', id: job.id, agentId: job.agent_id }),
        at: typeof job.started_at === 'string' ? job.started_at : '',
      }))
    return [...playbooks, ...jobs].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 5)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.jobs, data.playbookRuns, i18n.language])

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

  const openTicketChart = useMemo(() => {
    const rows = openCategories.slice(0, 6)
    const point = (row: CategoryRow, value: number) => ({ x: row.name.replace(/^#/, ''), y: value })
    return {
      open: rows.map((row) => point(row, row.open)),
      waiting: rows.map((row) => point(row, row.waiting)),
    }
  }, [openCategories])

  const weekChart = useMemo(
    () => ({
      current: [
        { x: copy('chartFiled'), y: trajectory.filed[0] },
        { x: copy('chartFinished'), y: trajectory.completed[0] },
      ],
      previous: [
        { x: copy('chartFiled'), y: trajectory.filed[1] },
        { x: copy('chartFinished'), y: trajectory.completed[1] },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trajectory, i18n.language],
  )

  const agentChart = useMemo(
    () =>
      (data.usage?.by_agent ?? [])
        .filter((row) => row.tokens > 0)
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 6)
        .map((row) => ({ x: row.agent_name || copy('chartUnknownAgent'), y: row.tokens })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.usage, i18n.language],
  )

  const savedChart = useMemo(
    () =>
      data.timeSaved
        .filter((row) => row.minutes > 0 && row.action !== 'manual_reply')
        .sort((a, b) => b.minutes - a.minutes)
        .map((row) => ({
          x: t(`ops.timeSaved.actions.${row.action}`, { defaultValue: row.action }),
          y: row.minutes,
        })),
    [data.timeSaved, t],
  )

  const trajectoryRows = [
    { label: copy('filedTickets'), values: trajectory.filed, to: '/settings/labels' },
    { label: copy('finishedRuns'), values: trajectory.completed, to: '/flows?view=runs&status=completed' },
  ] as const

  const closeQuiet = async (id: string) => {
    if (!token) return
    try {
      await bulkUpdateSignalThreads(token, [id], 'close')
      setData((prev) => ({ ...prev, quiet: prev.quiet.filter((row) => row.id !== id) }))
    } catch {
      setError(true)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <CockpitPanelsSkeleton />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-right text-xs text-status-warning">{copy('loadError')}</p> : null}

      <RecurringWakeBanner />

      <div
        className={
          data.quiet.length > 0
            ? 'grid min-w-0 items-stretch gap-4 lg:grid-cols-2'
            : 'min-w-0'
        }
      >
        <Block title={copy('needs')} hint={copy('needsHint')} index={0}>
          {data.needsYou.length === 0 ? (
            <div className="animate-fade-in rounded-lg border border-dashed border-border px-3 py-6 text-center">
              <p className="text-sm font-medium text-text-heading">{copy('emptyNeeds')}</p>
              <p className="mt-1 text-xs text-text-muted">{copy('emptyNeedsHint')}</p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <Link
                  to={forYouPath()}
                  className="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
                >
                  {copy('emptyNeedsForYou')}
                </Link>
                <Link
                  to="/settings/channels"
                  className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                >
                  {copy('emptyNeedsChannels')}
                </Link>
              </div>
            </div>
          ) : (
            data.needsYou.map((thread) => (
              <ThreadListItem
                key={String(thread.id)}
                thread={thread}
                isSelected={false}
                compact
                showActions={false}
                onSelect={() => navigate(attentionThreadPath(thread))}
              />
            ))
          )}
          <Link to={forYouPath()} className="link-draw block pt-1 text-right text-xs font-medium text-accent">
            {copy('allForYou', { count: forYouTotal })}
          </Link>
        </Block>

        {data.quiet.length > 0 ? (
          <Block title={copy('quiet')} hint={copy('quietHint')} index={1}>
            {data.quiet.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 py-1.5">
                <button
                  type="button"
                  className="min-w-0 truncate text-left text-sm text-text-primary hover:text-accent"
                  onClick={() => navigate(forYouPath(row.id))}
                >
                  {row.contactName || row.subject || row.id}
                </button>
                <Button type="button" size="sm" variant="secondary" onClick={() => void closeQuiet(row.id)}>
                  {copy('quietClose')}
                </Button>
              </div>
            ))}
          </Block>
        ) : null}
      </div>

      <AiHandlingMetricsBlock />

      <p className="px-0.5 text-xs font-medium uppercase tracking-wide text-text-muted">{copy('charts')}</p>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Block title={copy('chartOpenTitle')} hint={copy('chartOpenHint')} index={2}>
          <Chart
            kind="bar"
            stack
            height={168}
            ariaLabel={copy('chartOpenTitle')}
            emptyLabel={copy('emptySignals')}
            series={
              openTicketChart.open.length
                ? [
                    { name: copy('open'), points: openTicketChart.open },
                    { name: copy('waiting'), points: openTicketChart.waiting },
                  ]
                : []
            }
          />
        </Block>
        <Block title={copy('chartWeekTitle')} hint={copy('chartWeekHint')} index={3}>
          <Chart
            kind="bar"
            height={168}
            ariaLabel={copy('chartWeekTitle')}
            series={[
              { name: copy('chartThisWeek'), points: weekChart.current },
              { name: copy('chartLastWeek'), points: weekChart.previous },
            ]}
          />
        </Block>
        <Block title={copy('chartAgentsTitle')} hint={copy('chartAgentsHint')} index={4}>
          <Chart
            kind="bar"
            tone="ai"
            height={168}
            ariaLabel={copy('chartAgentsTitle')}
            emptyLabel={copy('chartAgentsEmpty')}
            series={agentChart.length ? [{ name: copy('chartTokens'), points: agentChart }] : []}
          />
        </Block>
        <Block title={copy('chartSavedTitle')} hint={copy('chartSavedHint')} index={5}>
          <Chart
            kind="bar"
            tone="ai"
            height={168}
            ariaLabel={copy('chartSavedTitle')}
            emptyLabel={copy('chartSavedEmpty')}
            series={savedChart.length ? [{ name: copy('chartMinutes'), points: savedChart }] : []}
          />
        </Block>
      </div>

      {data.improvements.length > 0 ? (
        <Block title={copy('improved')} hint={copy('improvedHint')} index={1}>
          {data.improvements.map((row) => (
            <Metric
              key={row.change_id}
              label={row.flow}
              value={row.autonomous_pct_now != null ? `${Math.round(row.autonomous_pct_now)}%` : '—'}
              detail={
                row.autonomous_pct_before != null
                  ? copy('improvedDetail', {
                      mode: t(`aiHandling.modes.${row.autonomy}.label`, { ns: 'common', defaultValue: row.autonomy }),
                      before: Math.round(row.autonomous_pct_before),
                    })
                  : copy('improvedDetailNew', {
                      mode: t(`aiHandling.modes.${row.autonomy}.label`, { ns: 'common', defaultValue: row.autonomy }),
                    })
              }
              to={workstreamPath(row.workstream_id)}
            />
          ))}
        </Block>
      ) : null}

      <p className="px-0.5 text-xs font-medium uppercase tracking-wide text-text-muted">{copy('moreContext')}</p>
      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        <Block title={copy('signals')} hint={copy('signalsHint')} index={1}>
          {openCategories.length === 0 ? <EmptyRow>{copy('emptySignals')}</EmptyRow> : openCategories.map((row) => (
            <Metric
              key={row.id}
              label={row.name.replace(/^#/, '')}
              value={String(row.open + row.waiting)}
              detail={`${copy('open')} ${row.open} · ${copy('waiting')} ${row.waiting}`}
              to={withNavReveal(tagPath(row.name, 'open'))}
            />
          ))}
          {proposedCount > 0 ? (
            <Metric
              label={copy('proposedTickets')}
              value={String(proposedCount)}
              detail={copy('proposedDetail')}
              to={forYouPath()}
            />
          ) : null}
        </Block>

        <Block title={copy('running')} hint={copy('runningHint')} index={2}>
          {agenda.due > 0 ? (
            <Link
              to="/agenda?view=list"
              className="row-interactive group flex items-center gap-3 rounded-md border border-status-warning/30 bg-status-warning/5 px-3 py-2.5 transition-colors hover:bg-status-warning/10"
            >
              <AlertTriangle size={14} className="shrink-0 text-status-warning" />
              <span className="min-w-0 flex-1">
                <span className="block truncate-fade text-sm font-medium text-text-primary">{copy('agendaDue')}</span>
                <span className="block truncate-fade text-xs text-text-muted">{copy('agendaDueDetail')}</span>
              </span>
              <span className="shrink-0 tabular-nums text-base font-semibold text-text-heading">{agenda.due}</span>
              <ArrowRight size={14} className="shrink-0 text-text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent" />
            </Link>
          ) : null}
          {running.length === 0 && agenda.upcoming.length === 0 && agenda.due === 0 ? <EmptyRow>{copy('emptyRunning')}</EmptyRow> : null}
          {agenda.upcoming.map((item) => (
            <Link
              key={item.id}
              to={timeItemHref(item)}
              className="row-interactive group flex items-center gap-3 rounded-md border border-transparent px-3 py-2.5 transition-colors hover:bg-bg-hover/70"
            >
              <CalendarClock size={14} className="shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate-fade text-sm font-medium text-text-primary">{item.title}</span>
                <span className="block truncate-fade text-xs text-text-muted">
                  {formatAppTime(new Date(parseTimelineMs(item.start)), i18n.language)} · {agendaKindLabel(agendaKindOf(item), t)}
                </span>
              </span>
              <ArrowRight size={14} className="shrink-0 text-text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent" />
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
                <Play size={14} className="relative text-accent opacity-90" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate-fade text-sm font-medium text-text-primary">{row.label}</span>
                <span className="block truncate-fade text-xs text-text-muted">{row.detail}</span>
              </span>
              <ArrowRight
                size={14}
                className="shrink-0 text-text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent"
              />
            </Link>
          ))}
          <Link to="/agenda" className="link-draw block pt-1 text-right text-xs font-medium text-accent">
            {copy('openAgenda')}
          </Link>
        </Block>

        <Block title={copy('trajectory')} hint={copy('trajectoryHint')} index={3}>
          {trajectoryRows.map((row) => (
            <Metric
              key={row.label}
              label={row.label}
              value={String(row.values[0])}
              detail={copy('vsLastWeek', { delta: delta(row.values[0], row.values[1]) })}
              to={row.to}
            />
          ))}
          <Metric
            label={copy('governWaiting')}
            value={String(data.govern.length)}
            detail={copy('governDetail')}
            to="/settings/govern?tab=drafts"
          />
          <Link
            to="/settings/usage"
            className="row-interactive group flex items-center gap-3 rounded-md border border-transparent px-3 py-2.5 transition-colors hover:bg-bg-hover/70"
          >
            <CircleDollarSign size={14} className="shrink-0 text-text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-text-primary">{copy('cost')}</span>
              <span className="block text-xs text-text-muted">{copy('costDetail')}</span>
            </span>
            <span className="text-xs font-semibold text-text-heading">
              {data.usage ? formatAppUsdCents(data.usage.total_customer_cost_micros / 10_000, i18n.language) : '—'}
            </span>
            <ArrowRight
              size={14}
              className="shrink-0 text-text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent"
            />
          </Link>
        </Block>
      </div>
    </div>
  )
}
