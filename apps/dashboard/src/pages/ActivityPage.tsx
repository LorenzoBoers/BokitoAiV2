import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Pause, Play, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatAppDateTime, formatAppTime } from '../lib/app-locale'
import { activityDayBucket } from '../lib/activity-day'
import {
  activitySearchParams,
  parseActivityDetail,
  parseActivityFollow,
  parseActivitySource,
  type ActivityDetail,
  type ActivitySource,
} from '../lib/activity-filters'
import { agentWorkforceRunUrl } from '../lib/workforce-run-urls'
import { threadHubPath } from '../lib/message-composer'
import { agentRunsPath, inboxPath } from '../lib/messages-paths'
import { talkToAssistantPath } from '../lib/talk-to-assistant'
import { workLogRunsPath } from '../lib/agenda-thread'
import { listThreads, type InboxThread } from '../lib/inbox-api'
import { PageGuideBanner } from '../components/layout/PageGuideBanner'
import ContentHeader from '../components/shell/ContentHeader'
import ConnectionStatus from '../components/shell/ConnectionStatus'
import CockpitTabs from '../components/shell/CockpitTabs'
import TimelineStrip, { type TimelinePoint } from '../components/cockpit/TimelineStrip'
import { useAuth } from '../context/AuthContext'
import { onGatewayEvent, type GatewayEvent } from '../lib/gateway'
import { bokitoGetCockpitActivity, type CockpitActivityEvent } from '../lib/bokito-api'
import { listAgendaOccurrences, type AgendaItem } from '../lib/orchestration-api'
import {
  activityEventMessage,
  activityEventTypeLabel,
  collapseCockpitEvents,
  isCockpitHeadlineEvent,
} from '../lib/activity-labels'

type ActivityEntry = {
  id: string
  kind: string
  eventType: string
  message: string
  actorName: string | null
  createdAt: string
  live: boolean
  runId: string | null
  agentId: string | null
  signalId: string | null
}

type SourceFilter = 'all' | 'agents' | 'people'
type DetailFilter = 'headlines' | 'all'

const MAX_ENTRIES = 1000
const HISTORY_PAGE = 100

function fromCockpit(ev: CockpitActivityEvent, idx: number): ActivityEntry {
  return {
    id: ev.id ?? `hist-${ev.created_at}-${idx}`,
    kind: ev.kind,
    eventType: ev.event_type,
    message: ev.message || '',
    actorName: ev.actor_name ?? null,
    createdAt: ev.created_at,
    live: false,
    runId: ev.run_id ?? null,
    agentId: ev.agent_id ?? null,
    signalId: ev.signal_id ?? null,
  }
}

function parseUtc(iso: string): Date {
  return new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`)
}

function fromGateway(event: GatewayEvent): ActivityEntry | null {
  const data = event.data
  const message =
    typeof data.message === 'string'
      ? data.message
      : typeof data.subject === 'string'
        ? data.subject
        : ''
  return {
    id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: event.event || 'event',
    eventType: typeof data.event_type === 'string' ? data.event_type : typeof data.status === 'string' ? data.status : event.event,
    message,
    actorName: null,
    createdAt: event.ts ?? new Date().toISOString(),
    live: true,
    runId: typeof data.run_id === 'string' ? data.run_id : null,
    agentId: typeof data.agent_id === 'string' ? data.agent_id : null,
    signalId: typeof data.signal_id === 'string' ? data.signal_id : null,
  }
}

function formatTime(iso: string, language?: string | null): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : formatAppTime(d, language)
}

export default function ActivityPage() {
  const { t, i18n } = useTranslation('nav')
  const { token } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [planned, setPlanned] = useState<AgendaItem[]>([])
  const [runThreads, setRunThreads] = useState<InboxThread[]>([])
  const filter = searchParams.get('q') ?? ''
  const source = parseActivitySource(searchParams.get('source'))
  const detail = parseActivityDetail(searchParams.get('detail'))
  const autoFollow = parseActivityFollow(searchParams.get('follow'))
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMoreHistory, setHasMoreHistory] = useState(true)
  const [loadError, setLoadError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const patchFilters = useCallback(
    (patch: {
      source?: ActivitySource
      detail?: ActivityDetail
      q?: string
      follow?: boolean
    }) => {
      setSearchParams(activitySearchParams(searchParams, patch), { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setLoadError('')
    try {
      const rows = await bokitoGetCockpitActivity(token, HISTORY_PAGE)
      setEntries(rows.map(fromCockpit).reverse())
      setHasMoreHistory(rows.length >= HISTORY_PAGE)
    } catch {
      setEntries([])
      setLoadError(t('activityPage.loadError'))
    } finally {
      setLoading(false)
      setRefreshedAt(new Date())
    }
  }, [token, t])

  useEffect(() => {
    void load()
  }, [load])

  // Upcoming planned agenda items (scheduled wakes / one-off tasks) shown on
  // the timeline right of "now" — the agenda page manages them, this view
  // just situates them on the same time axis as executed work.
  useEffect(() => {
    if (!token) return
    let cancelled = false
    const run = async () => {
      try {
        const now = new Date()
        const items = await listAgendaOccurrences({
          from: now.toISOString(),
          to: new Date(now.getTime() + 24 * 3_600_000).toISOString(),
        })
        if (!cancelled) setPlanned(items.filter((i) => i.status === 'planned' && i.enabled))
      } catch {
        if (!cancelled) setPlanned([])
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void listThreads(token, { folder: 'internal', perPage: 80 })
      .then((found) => {
        if (!cancelled) setRunThreads(found.items)
      })
      .catch(() => {
        if (!cancelled) setRunThreads([])
      })
    return () => {
      cancelled = true
    }
  }, [token])

  // Scrolling the timeline to its left edge pages further into history.
  const loadOlder = useCallback(async () => {
    if (!token || loadingOlder || !hasMoreHistory) return
    const oldest = entries.find((e) => !e.live)
    if (!oldest) return
    setLoadingOlder(true)
    try {
      const rows = await bokitoGetCockpitActivity(token, HISTORY_PAGE, oldest.createdAt)
      if (rows.length < HISTORY_PAGE) setHasMoreHistory(false)
      if (rows.length) {
        const older = rows.map(fromCockpit).reverse()
        setEntries((prev) => {
          const seen = new Set(prev.map((e) => e.id))
          return [...older.filter((e) => !seen.has(e.id)), ...prev]
        })
      }
    } catch {
      setHasMoreHistory(false)
    } finally {
      setLoadingOlder(false)
    }
  }, [token, loadingOlder, hasMoreHistory, entries])

  const timelinePoints = useMemo<TimelinePoint[]>(() => {
    const eventPoints: TimelinePoint[] = entries.map((e) => ({
      id: e.id,
      at: parseUtc(e.createdAt),
      label: activityEventMessage(e.message, t) || activityEventTypeLabel(e.eventType, t),
        sublabel: e.kind === 'audit' ? e.actorName || t('activityPage.teamMember') : activityEventTypeLabel(e.kind, t),
      tone:
        e.eventType === 'failed' || e.eventType === 'error'
          ? 'error'
          : e.live
            ? 'live'
            : 'past',
    }))
    const plannedPoints: TimelinePoint[] = planned.map((item) => ({
      id: `planned-${item.id}`,
      at: parseUtc(item.at),
      label: item.name,
      sublabel: item.agent_name ?? undefined,
      tone: 'planned',
    }))
    return [...eventPoints, ...plannedPoints]
  }, [entries, planned, t])

  // Live stream of run events.
  useEffect(() => {
    if (!token) return
    const push = (event: GatewayEvent) => {
      const entry = fromGateway(event)
      if (!entry) return
      setEntries((prev) => {
        const next = [...prev, entry]
        return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next
      })
    }
    const unsubs = [onGatewayEvent('runs', push), onGatewayEvent('decisions', push)]
    return () => unsubs.forEach((u) => u())
  }, [token])

  useEffect(() => {
    if (!autoFollow) return
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries, autoFollow])

  const bySource =
    source === 'all'
      ? entries
      : entries.filter((e) => (source === 'people' ? e.kind === 'audit' : e.kind !== 'audit'))
  const filtered = filter.trim()
    ? bySource.filter((e) => {
        const q = filter.trim().toLowerCase()
        return (
          e.message.toLowerCase().includes(q) ||
          e.kind.toLowerCase().includes(q) ||
          e.eventType.toLowerCase().includes(q) ||
          (e.actorName ?? '').toLowerCase().includes(q)
        )
      })
    : bySource
  const scoped =
    detail === 'headlines'
      ? filtered.filter((entry) =>
          isCockpitHeadlineEvent({ event_type: entry.eventType, message: entry.message }),
        )
      : filtered
  const visible = collapseCockpitEvents(
    scoped.map((entry) => ({
      ...entry,
      signal_id: entry.signalId,
      event_type: entry.eventType,
      actor_name: entry.actorName,
    })),
  )

  return (
    <div>
      <PageGuideBanner page="cockpit" className="mb-4" />
      <ContentHeader
        title={t('tabs.cockpit.title')}
        subtitle={t('pageHeaders.cockpitActivity')}
        meta={
          <>
            <ConnectionStatus />
            {refreshedAt ? (
              <span className="text-[11px] text-text-muted">
                {t('activityPage.refreshedAt', { time: formatAppTime(refreshedAt, i18n.language) })}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void load()}
              className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              {t('activityPage.refresh')}
            </button>
          </>
        }
      />

      <CockpitTabs />

      {loadError ? (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-[12.5px] text-status-error">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-status-error/40 px-2 py-0.5 text-[11.5px] font-medium hover:bg-status-error/15"
          >
            {t('activityPage.retry')}
          </button>
        </div>
      ) : null}

      {/* Horizontal platform timeline: executed work left of Now, planned
          agenda items right of it. */}
      <TimelineStrip
        points={timelinePoints}
        onLoadOlder={() => void loadOlder()}
        hasMore={hasMoreHistory}
        loadingOlder={loadingOlder}
      />

      {/* Filter bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border border-border/60 p-0.5">
          {(
            [
              ['all', 'activityPage.all'],
              ['agents', 'activityPage.agents'],
              ['people', 'activityPage.people'],
            ] as [SourceFilter, string][]
          ).map(([value, labelKey]) => (
            <button
              key={value}
              type="button"
              onClick={() => patchFilters({ source: value })}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                source === value
                  ? 'bg-accent/12 text-accent'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
        <div className="flex items-center rounded-lg border border-border/60 p-0.5">
          {(
            [
              ['headlines', 'activityPage.headlines'],
              ['all', 'activityPage.fullLog'],
            ] as [DetailFilter, string][]
          ).map(([value, labelKey]) => (
            <button
              key={value}
              type="button"
              title={t(value === 'headlines' ? 'activityPage.headlinesHint' : 'activityPage.fullLogHint')}
              onClick={() => patchFilters({ detail: value })}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                detail === value
                  ? 'bg-accent/12 text-accent'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
        <input
          value={filter}
          onChange={(e) => patchFilters({ q: e.target.value })}
          placeholder={t('activityPage.filterPlaceholder')}
          className="h-8 w-full max-w-[280px] rounded-lg border border-border/60 bg-bg-input px-3 text-[12.5px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
        />
        <button
          type="button"
          onClick={() => patchFilters({ follow: !autoFollow })}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
            autoFollow
              ? 'border-accent/45 bg-accent/10 text-accent'
              : 'border-border/60 text-text-secondary hover:bg-bg-hover/60'
          }`}
        >
          {autoFollow ? <Pause size={12} /> : <Play size={12} />}
          {t('activityPage.autoFollow')}
        </button>
        <button
          type="button"
          title={t('activityPage.clearView')}
          onClick={() => {
            const snapshot = entries
            setEntries([])
            toast(t('activityPage.cleared'), {
              action: {
                label: t('activityPage.undoClear'),
                onClick: () => setEntries(snapshot),
              },
            })
          }}
          className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
        >
          <Trash2 size={12} />
          {t('activityPage.clearView')}
        </button>
        <span className="ml-auto text-[11px] text-text-muted">{t('activityPage.events', { count: visible.length })}</span>
      </div>

      {/* Event list */}
      <div
        ref={listRef}
        className="h-[calc(100vh-300px)] min-h-[280px] overflow-y-auto rounded-xl border border-border/60 bg-bg-elevated"
      >
        {visible.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-[12.5px] text-text-muted">
              {filtered.length > 0 && detail === 'headlines'
                ? t('activityPage.emptyHeadlines')
                : entries.length > 0 && (filter.trim() || source !== 'all')
                  ? t('activityPage.emptyFiltered')
                  : t('activityPage.empty')}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              {filtered.length > 0 && detail === 'headlines' ? (
                <>
                  <button
                    type="button"
                    onClick={() => patchFilters({ detail: 'all' })}
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
                  >
                    {t('activityPage.showFullLog')}
                  </button>
                  <Link
                    to={inboxPath('open')}
                    className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                  >
                    {t('activityPage.openCommunication')}
                  </Link>
                </>
              ) : entries.length > 0 && (filter.trim() || source !== 'all') ? (
                <button
                  type="button"
                  onClick={() => {
                    patchFilters({ q: '', source: 'all' })
                  }}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
                >
                  {t('activityPage.clearFilters')}
                </button>
              ) : (
                <>
                  <Link
                    to={inboxPath('open')}
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
                  >
                    {t('activityPage.openCommunication')}
                  </Link>
                  <Link
                    to={talkToAssistantPath(t('activityPage.talkPrefill'))}
                    className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                  >
                    {t('activityPage.talkAssistant')}
                  </Link>
                </>
              )}
              <Link
                to="/agents"
                className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
              >
                {t('activityPage.openAgents')}
              </Link>
              <Link
                to="/agenda"
                className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
              >
                {t('activityPage.openAgenda')}
              </Link>
              <Link
                to="/settings/setup"
                className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
              >
                {t('activityPage.openSetup')}
              </Link>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {visible.map((entry, index) => {
              const day = activityDayBucket(entry.createdAt)
              const prevDay = index > 0 ? activityDayBucket(visible[index - 1]!.createdAt) : null
              const showDayHeading = day !== prevDay
              const completed = /complet/i.test(`${entry.eventType} ${entry.message}`)
              const href = entry.signalId
                ? entry.kind === 'audit'
                  ? threadHubPath({ id: entry.signalId, channel: 'email' })
                  : agentRunsPath(completed ? 'results' : 'all', entry.signalId)
                : entry.agentId && entry.runId
                  ? agentWorkforceRunUrl(entry.agentId, entry.runId)
                  : entry.agentId
                  ? workLogRunsPath(
                      {
                        task_subject: /^(run |executed )/i.test(entry.message) ? '' : entry.message,
                        started_at: entry.createdAt,
                        status: completed ? 'completed' : 'running',
                      },
                      runThreads,
                      agentRunsPath(completed ? 'results' : 'all'),
                    )
                  : null
              const inner = (
                <>
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      entry.eventType === 'failed' || entry.eventType === 'error'
                        ? 'bg-status-error'
                        : entry.live
                          ? 'bg-status-success'
                          : 'bg-text-muted/50'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-[12.5px] text-text-primary">
                      {activityEventMessage(entry.message, t) || activityEventTypeLabel(entry.eventType, t)}
                      {entry.repeatCount > 1
                        ? ` · ${t('cockpitPage.eventRepeats', { count: entry.repeatCount })}`
                        : ''}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 text-[10.5px] text-text-muted">
                      <span>
                        {entry.kind === 'audit'
                          ? `${entry.actorName || t('activityPage.teamMember')} - ${activityEventTypeLabel(entry.eventType, t)}`
                          : `${entry.actorName ? `${entry.actorName} - ` : ''}${activityEventTypeLabel(entry.eventType, t)}`}
                      </span>
                      {entry.runId ? (
                        <button
                          type="button"
                          title={entry.runId}
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            void navigator.clipboard.writeText(entry.runId!).then(
                              () => toast.success(t('activityPage.idCopied')),
                              () => toast.error(t('activityPage.copyFailed')),
                            )
                          }}
                          className="font-mono hover:text-accent hover:underline"
                        >
                          run
                        </button>
                      ) : null}
                      {entry.signalId ? (
                        <button
                          type="button"
                          title={entry.signalId}
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            void navigator.clipboard.writeText(entry.signalId!).then(
                              () => toast.success(t('activityPage.idCopied')),
                              () => toast.error(t('activityPage.copyFailed')),
                            )
                          }}
                          className="font-mono hover:text-accent hover:underline"
                        >
                          thread
                        </button>
                      ) : null}
                      {entry.agentId ? (
                        <button
                          type="button"
                          title={entry.agentId}
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            void navigator.clipboard.writeText(entry.agentId!).then(
                              () => toast.success(t('activityPage.idCopied')),
                              () => toast.error(t('activityPage.copyFailed')),
                            )
                          }}
                          className="font-mono hover:text-accent hover:underline"
                        >
                          agent
                        </button>
                      ) : null}
                    </p>
                  </div>
                  <span
                    className="shrink-0 font-mono text-[10.5px] text-text-muted"
                    title={
                      entry.createdAt
                        ? formatAppDateTime(new Date(entry.createdAt), i18n.language)
                        : undefined
                    }
                  >
                    {formatTime(entry.createdAt, i18n.language)}
                  </span>
                </>
              )
              const row = href ? (
                <Link
                  to={href}
                  className="flex items-start gap-3 px-4 py-2 transition-colors hover:bg-bg-hover/40"
                >
                  {inner}
                </Link>
              ) : (
                <div className="flex items-start gap-3 px-4 py-2">
                  {inner}
                </div>
              )
              return (
                <div key={entry.id}>
                  {showDayHeading ? (
                    <p className="sticky top-0 z-10 bg-bg-elevated/95 px-4 py-1.5 text-[11px] font-medium text-text-muted">
                      {t(
                        day === 'today'
                          ? 'activityPage.dayToday'
                          : day === 'yesterday'
                            ? 'activityPage.dayYesterday'
                            : 'activityPage.dayOlder',
                      )}
                    </p>
                  ) : null}
                  {row}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
